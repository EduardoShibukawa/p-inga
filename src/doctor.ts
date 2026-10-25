import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { claudeAdapter } from "./adapters/claude";
import { hermesAdapter } from "./adapters/hermes";
import { opencodeAdapter } from "./adapters/opencode";
import { piAdapter } from "./adapters/pi";
import { tuiosAdapter } from "./adapters/tuios";
import { attestFromEndpoint } from "./family";
import { ADAPTER_ORDER, type Adapter, type Probe } from "./install";
import {
  defaultManifestPath,
  sha256File,
  validateManifest,
} from "./manifest";

const ROOT = resolve(import.meta.dir, "..");

export const DOCTOR_STATUSES = [
  "ok",
  "degraded",
  "broken",
  "unverified",
] as const;

export type DoctorStatus = (typeof DOCTOR_STATUSES)[number];

export type DoctorRecord = {
  harness: string;
  check: string;
  status: DoctorStatus;
  law2: "pass" | "fail" | "blocked" | "not run";
  cmd: string[] | null;
  exit: number | null;
  stdout_sha256: string | null;
  duration_ms: number | null;
  detail: string;
};

export const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

export const MANIFEST_CMD = ["pinga:internal", "manifest"] as const;

function sha256hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** I18 (Lei 2): mapeia o status do doctor para a verificação da Lei 2. */
export function law2For(
  status: DoctorStatus,
  cause?: "missing" | "filtered" | "timeout" | "infra" | "empty",
): DoctorRecord["law2"] {
  if (status === "ok") return "pass";
  if (status === "degraded" || status === "broken") return "fail";
  if (cause === "missing" || cause === "infra") return "blocked";
  return "not run";
}

/**
 * I18: um registro `ok` sem execução real (cmd nulo, exit != 0, stdout vazio)
 * é rebaixado para `unverified`/`not run`.
 */
export function finalizeRecord(r: DoctorRecord): DoctorRecord {
  const detail = r.detail.length > 200 ? `${r.detail.slice(0, 200)}` : r.detail;
  if (
    r.status === "ok" &&
    (r.cmd === null ||
      r.exit !== 0 ||
      r.stdout_sha256 === null ||
      r.stdout_sha256 === EMPTY_SHA256)
  ) {
    return {
      ...r,
      detail: `rebaixado: ${detail}`,
      status: "unverified",
      law2: "not run",
    };
  }
  return { ...r, detail };
}

function record(
  harness: string,
  check: string,
  status: DoctorStatus,
  law2: DoctorRecord["law2"],
  cmd: string[] | null,
  exit: number | null,
  stdoutSha: string | null,
  durationMs: number | null,
  detail: string,
): DoctorRecord {
  return {
    harness,
    check,
    status,
    law2,
    cmd,
    exit,
    stdout_sha256: stdoutSha,
    duration_ms: durationMs,
    detail: detail.length > 200 ? detail.slice(0, 200) : detail,
  };
}

export type DoctorOptions = {
  home: string;
  only?: string;
  endpoint?: string;
  manifestPath?: string;
  env?: Record<string, string | undefined>;
};

/** Fonte do pi-harness (mesma porta do install). */
function sourceOf(env: Record<string, string | undefined>): string {
  const value = env.PINGA_PI_HARNESS_DIR;
  if (value === undefined || value === "") {
    return resolve(ROOT, "../pi-harness");
  }
  return value;
}

const ADAPTERS: Record<string, Adapter> = {
  pi: piAdapter,
  claude: claudeAdapter,
  opencode: opencodeAdapter,
  hermes: hermesAdapter,
  tuios: tuiosAdapter,
};

function isFiltered(harness: string, only?: string): boolean {
  return only !== undefined && only !== harness;
}

/** Registro filtrado por --only: não executado. */
function filteredRecord(harness: string, check: string): DoctorRecord {
  return record(
    harness,
    check,
    "unverified",
    law2For("unverified", "filtered"),
    null,
    null,
    null,
    null,
    "filtrado por --only",
  );
}

/** §9 manifest/integrity: conferência interna do manifest contra o HOME. */
function manifestIntegrityRecord(
  opts: DoctorOptions,
  env: Record<string, string | undefined>,
): DoctorRecord {
  const t0 = Date.now();
  if (isFiltered("manifest", opts.only)) {
    return filteredRecord("manifest", "integrity");
  }
  const manifestPath = opts.manifestPath ?? defaultManifestPath(env);
  if (!existsSync(manifestPath)) {
    return record(
      "manifest",
      "integrity",
      "unverified",
      law2For("unverified"),
      null,
      null,
      null,
      Date.now() - t0,
      "nada instalado (manifest ausente)",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return record(
      "manifest",
      "integrity",
      "broken",
      law2For("broken"),
      [...MANIFEST_CMD],
      null,
      null,
      Date.now() - t0,
      `manifest inválido: ${(e as Error).message}`,
    );
  }
  const validated = validateManifest(parsed);
  if (!validated.ok) {
    return record(
      "manifest",
      "integrity",
      "broken",
      law2For("broken"),
      [...MANIFEST_CMD],
      null,
      null,
      Date.now() - t0,
      `manifest inválido: ${validated.errors[0] ?? "?"}`,
    );
  }
  const entries = validated.manifest.entries;
  if (entries.length === 0) {
    return record(
      "manifest",
      "integrity",
      "unverified",
      law2For("unverified"),
      null,
      null,
      null,
      Date.now() - t0,
      "nada instalado (sem entradas)",
    );
  }

  const lines: string[] = [];
  const absent: string[] = [];
  const divergent: string[] = [];
  for (const e of entries) {
    const current = sha256File(join(opts.home, e.target_file));
    lines.push(`${e.sha256_post} ${current} ${e.target_file}`);
    if (current === "absent") {
      absent.push(e.target_file);
    } else if (current !== e.sha256_post) {
      divergent.push(e.target_file);
    }
  }
  const stdout = `${lines.join("\n")}\n`;
  const stdoutSha = sha256hex(stdout);
  const duration = Date.now() - t0;
  if (absent.length > 0) {
    return record(
      "manifest",
      "integrity",
      "broken",
      law2For("broken"),
      [...MANIFEST_CMD],
      0,
      stdoutSha,
      duration,
      `alvo ausente: ${absent.sort().join(", ")}`,
    );
  }
  if (divergent.length > 0) {
    return record(
      "manifest",
      "integrity",
      "degraded",
      law2For("degraded"),
      [...MANIFEST_CMD],
      0,
      stdoutSha,
      duration,
      `sha256 divergente: ${divergent.sort().join(", ")}`,
    );
  }
  return record(
    "manifest",
    "integrity",
    "ok",
    law2For("ok"),
    [...MANIFEST_CMD],
    0,
    stdoutSha,
    duration,
    `manifest íntegro (${entries.length} entradas)`,
  );
}

/** §8: roda um probe com o HOME do --home; ausência/timeout/filtragem tratados. */
function runProbe(
  harness: string,
  adapter: Adapter,
  probe: Probe,
  opts: {
    home: string;
    source: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
    only?: string;
  },
): DoctorRecord {
  if (isFiltered(harness, opts.only)) {
    return filteredRecord(harness, probe.check);
  }
  const t0 = Date.now();
  const args = probe.cmd({ source: opts.source });
  const bin = adapter.bin ?? args[0] ?? "";
  const PATH = opts.env.PATH ?? process.env.PATH ?? "";
  const resolved = bin === "" ? null : Bun.which(bin, { PATH });
  if (resolved === null) {
    return record(
      harness,
      probe.check,
      "unverified",
      law2For("unverified", "missing"),
      null,
      null,
      null,
      Date.now() - t0,
      `${bin || "cli"} ausente`,
    );
  }
  const cmd = [bin, ...args];
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.env)) {
    if (typeof value === "string") childEnv[key] = value;
  }
  childEnv.HOME = opts.home;
  let exit: number | null;
  let stdout = "";
  let timedOut = false;
  try {
    const res = Bun.spawnSync([resolved, ...args], {
      cwd: opts.home,
      timeout: opts.timeoutMs,
      env: childEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    exit = res.exitCode;
    stdout = res.stdout.toString();
    timedOut = res.exitedDueToTimeout === true;
  } catch {
    exit = null;
  }
  const duration = Date.now() - t0;
  if (timedOut || exit === null) {
    return record(
      harness,
      probe.check,
      "unverified",
      law2For("unverified", "timeout"),
      cmd,
      null,
      null,
      duration,
      `timeout: probe sem resposta em ${opts.timeoutMs} ms`,
    );
  }
  // §8: exit 0 com stdout vazio (só espaços) -> degraded, sempre.
  if (exit === 0 && stdout.trim() === "") {
    return record(
      harness,
      probe.check,
      "degraded",
      law2For("degraded", "empty"),
      cmd,
      exit,
      sha256hex(stdout),
      duration,
      `exit 0 com saída vazia em ${probe.check}`,
    );
  }
  const verdict = probe.classify({ exit, stdout });
  return record(
    harness,
    probe.check,
    verdict.status,
    law2For(verdict.status),
    cmd,
    exit,
    sha256hex(stdout),
    duration,
    verdict.detail,
  );
}

/** §10 llm/models: atestação do endpoint (T08). */
async function llmRecord(
  opts: DoctorOptions,
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<DoctorRecord> {
  const t0 = Date.now();
  if (isFiltered("llm", opts.only)) {
    return filteredRecord("llm", "models");
  }
  const endpoint =
    opts.endpoint ??
    (typeof env.PINGA_JUDGE_ENDPOINT === "string" &&
    env.PINGA_JUDGE_ENDPOINT !== ""
      ? env.PINGA_JUDGE_ENDPOINT
      : "http://127.0.0.1:8089");
  const cmd = ["GET", `${endpoint.replace(/\/+$/, "")}/v1/models`];
  const res = await attestFromEndpoint(endpoint, null, { timeoutMs });
  const duration = Date.now() - t0;
  if (res.ok) {
    return record(
      "llm",
      "models",
      "ok",
      law2For("ok"),
      cmd,
      0,
      sha256hex(res.attested.served),
      duration,
      `served ${res.attested.served}`,
    );
  }
  if (res.reason_code === "model_unattested") {
    return record(
      "llm",
      "models",
      "degraded",
      law2For("degraded"),
      cmd,
      null,
      null,
      duration,
      res.error,
    );
  }
  return record(
    "llm",
    "models",
    "unverified",
    law2For("unverified", "infra"),
    cmd,
    null,
    null,
    duration,
    res.error,
  );
}

/** §7: 9 registros, nesta ordem. */
export async function runDoctor(opts: DoctorOptions): Promise<DoctorRecord[]> {
  const env = opts.env ?? process.env;
  const timeoutMs = Number(env.PINGA_DOCTOR_TIMEOUT_MS ?? 30000);
  const source = sourceOf(env);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;

  const records: DoctorRecord[] = [manifestIntegrityRecord(opts, env)];

  for (const harness of ADAPTER_ORDER) {
    const adapter = ADAPTERS[harness]!;
    for (const probe of adapter.probes ?? []) {
      records.push(
        runProbe(harness, adapter, probe, {
          home: opts.home,
          source,
          env,
          timeoutMs: timeout,
          only: opts.only,
        }),
      );
    }
  }

  records.push(await llmRecord(opts, env, timeout));

  return records.map(finalizeRecord);
}

export async function doctorCmd(
  opts: DoctorOptions & { json: boolean },
): Promise<number> {
  const records = await runDoctor(opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify(records, null, 2) + "\n");
  } else {
    for (const r of records) {
      console.log(`${r.status} ${r.harness}/${r.check}: ${r.detail}`);
    }
  }
  return records.some((r) => r.status === "broken") ? 1 : 0;
}
