import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  lstatSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { claudeAdapter } from "./adapters/claude";
import {
  type Manifest,
  type ManifestEntry,
  backupFile,
  defaultManifestPath,
  readManifest,
  sha256File,
  writeAtomic,
} from "./manifest";
import {
  type Change,
  type FileDiff,
  jsonPointerDiff,
  renderDiff,
  withShadow,
} from "./shadow";

const ROOT = resolve(import.meta.dir, "..");

export const INSTALL_EXIT = {
  ok: 0,
  usage: 2,
  infra: 8,
  foreign_key: 11,
  config_invalid: 12,
  revert_drift: 13,
  backup_corrupt: 14,
} as const;

export type AdapterContext = { source: string; now: string };

export type Adapter = {
  harness: "claude" | "pi" | "opencode" | "hermes" | "tuios";
  targets: string[];
  owned: Record<string, string[]>;
  volatile: Record<string, string[]>;
  apply(shadowHome: string, ctx: AdapterContext): void | Promise<void>;
};

export type InstallOptions = {
  mode: "dry-run" | "apply" | "revert";
  home: string;
  manifestPath?: string;
  adapters?: Adapter[];
  env?: Record<string, string | undefined>;
};

function sha256hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function pickSource(env: Record<string, string | undefined>): string {
  const value = env.PINGA_PI_HARNESS_DIR;
  if (value === undefined || value === "") {
    return resolve(ROOT, "../pi-harness");
  }
  return value;
}

function pickNow(env: Record<string, string | undefined>): string {
  const value = env.PINGA_NOW;
  if (value === undefined || value === "") return new Date().toISOString();
  return value;
}

/** Fonte válida: .claude-plugin/marketplace.json com nome e plugin certos. */
function validateSource(source: string): string | null {
  const manifestPath = join(source, ".claude-plugin/marketplace.json");
  if (!existsSync(manifestPath)) {
    return "fonte sem .claude-plugin/marketplace.json";
  }
  let market: unknown;
  try {
    market = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return "fonte com .claude-plugin/marketplace.json ilegível";
  }
  if (
    typeof market !== "object" ||
    market === null ||
    (market as Record<string, unknown>).name !== "pi-harness-local"
  ) {
    return "fonte com .claude-plugin/marketplace.json sem name: pi-harness-local";
  }
  const plugins = (market as Record<string, unknown>).plugins;
  if (
    !Array.isArray(plugins) ||
    !plugins.some(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as Record<string, unknown>).name === "pi-harness",
    )
  ) {
    return "fonte sem o plugin pi-harness";
  }
  return null;
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith("/")) return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function pointerExists(doc: unknown, pointer: string): boolean {
  if (pointer === "") return true;
  let current: unknown = doc;
  for (const seg of pointerSegments(pointer)) {
    if (current === null || typeof current !== "object") return false;
    if (Array.isArray(current)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= current.length) return false;
      current = current[i];
    } else {
      if (!(seg in current)) return false;
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return true;
}

function isConfigInvalid(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e as Error & { code?: string }).code === "config_invalid"
  );
}

/** Guarda A2: ponteiro alheio ou entrada homônima não registrada no manifest. */
export function checkForeign(input: {
  adapter: Adapter;
  file: string;
  before: unknown;
  after: unknown;
  changes: Change[];
  manifest: Manifest;
}): { ok: true } | { ok: false; pointers: string[] } {
  if (input.before === undefined) return { ok: true };
  const owned = input.adapter.owned[input.file] ?? [];
  const bad: string[] = [];

  for (const change of input.changes) {
    const allowed = owned.some(
      (ownedPtr) =>
        change.pointer === ownedPtr ||
        change.pointer.startsWith(`${ownedPtr}/`),
    );
    if (!allowed) bad.push(change.pointer);
  }

  // Homônima: chave que é do pinga e já existia, sem registro no manifest.
  for (const ownedPtr of owned) {
    if (!pointerExists(input.before, ownedPtr)) continue;
    const registered = input.manifest.entries.some(
      (e) =>
        e.harness === input.adapter.harness &&
        e.target_file === input.file &&
        (e.key_path === ownedPtr || e.key_path === undefined),
    );
    if (!registered) bad.push(ownedPtr);
  }

  if (bad.length > 0) {
    return { ok: false, pointers: Array.from(new Set(bad)).sort() };
  }
  return { ok: true };
}

/** Arquivos/symlinks na sombra que não são alvos de nenhum adaptador. */
function scanForeignFiles(shadowHome: string, targets: string[]): string[] {
  const targetSet = new Set(targets);
  const foreign: string[] = [];

  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(shadowHome, abs).replace(/\\/g, "/");
      const st = lstatSync(abs);
      if (st.isDirectory()) {
        walk(abs);
      } else if (!targetSet.has(rel)) {
        foreign.push(rel);
      } else if (st.isSymbolicLink() && !existsSync(abs)) {
        foreign.push(rel);
      }
    }
  }

  if (existsSync(shadowHome)) walk(shadowHome);
  return foreign.sort();
}

type TargetInfo = {
  adapter: Adapter;
  file: string;
  status: "new" | "removed" | "changed";
  before: unknown;
  after: unknown;
  changes: Change[];
  existed: boolean;
};

type PendingWrite = { file: string; bytes: Buffer };

function installManifestEntries(
  manifest: Manifest,
  infos: Array<{ info: TargetInfo; preSha: string; postSha: string; backupPath: string }>,
  now: string,
): ManifestEntry[] {
  const entries = [...manifest.entries];
  for (const { info, preSha, postSha, backupPath } of infos) {
    const keyPaths =
      info.status === "new"
        ? [undefined]
        : (info.adapter.owned[info.file] ?? []);
    for (const keyPath of keyPaths) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (
          e.harness === info.adapter.harness &&
          e.target_file === info.file &&
          (e.key_path ?? undefined) === (keyPath ?? undefined)
        ) {
          entries.splice(i, 1);
        }
      }
      entries.push({
        harness: info.adapter.harness,
        target_file: info.file,
        ...(keyPath !== undefined ? { key_path: keyPath } : {}),
        sha256_pre: preSha,
        sha256_post: postSha,
        installed_at: now,
        backup_path: backupPath,
      });
    }
  }
  return entries;
}

async function revertCmd(opts: InstallOptions, manifestPath: string): Promise<number> {
  let manifest: Manifest;
  try {
    manifest = readManifest(manifestPath);
  } catch (e) {
    console.error(`pinga install: ${errorMessage(e)}`);
    return INSTALL_EXIT.config_invalid;
  }

  if (manifest.entries.length === 0) {
    console.log("nada a reverter");
    return INSTALL_EXIT.ok;
  }

  const home = opts.home;

  // Pré-checagem antes de escrever qualquer coisa.
  const drift: string[] = [];
  for (const entry of manifest.entries) {
    if (sha256File(join(home, entry.target_file)) !== entry.sha256_post) {
      if (!drift.includes(entry.target_file)) drift.push(entry.target_file);
    }
  }
  if (drift.length > 0) {
    for (const file of drift.sort()) {
      console.error(`pinga install: drift em ${file} (sha256 atual != sha256_post)`);
    }
    return INSTALL_EXIT.revert_drift;
  }

  for (const entry of manifest.entries) {
    if (entry.backup_path === "") continue;
    if (sha256File(entry.backup_path) !== entry.sha256_pre) {
      console.error(
        `pinga install: backup ausente ou corrompido: ${entry.backup_path}`,
      );
    }
  }
  for (const entry of manifest.entries) {
    if (entry.backup_path === "") continue;
    if (sha256File(entry.backup_path) !== entry.sha256_pre) {
      return INSTALL_EXIT.backup_corrupt;
    }
  }

  // Restaura e confere.
  for (const entry of manifest.entries) {
    const target = join(home, entry.target_file);
    if (entry.sha256_pre === "absent") {
      rmSync(target, { force: true });
    } else {
      writeAtomic(target, readFileSync(entry.backup_path));
    }
    if (sha256File(target) !== entry.sha256_pre) {
      console.error(
        `pinga install: restauração não conferiu para ${entry.target_file}`,
      );
      return INSTALL_EXIT.infra;
    }
  }

  writeAtomic(
    manifestPath,
    JSON.stringify({ version: 1, entries: [] }, null, 2) + "\n",
  );
  return INSTALL_EXIT.ok;
}

export async function installCmd(opts: InstallOptions): Promise<number> {
  const env = opts.env ?? process.env;
  const manifestPath = opts.manifestPath ?? defaultManifestPath(env);
  const planPath = join(dirname(manifestPath), "install-plan.json");
  const stateDir = dirname(manifestPath);
  const source = pickSource(env);
  const now = pickNow(env);
  const adapters = opts.adapters ?? [claudeAdapter];

  // Ajuda testes diretos (sem spawn): roda a sombra no TMPDIR do env informado.
  const envTmp = env.TMPDIR;
  const prevTmp =
    envTmp !== undefined && envTmp !== "" ? process.env.TMPDIR : undefined;

  try {
    if (envTmp !== undefined && envTmp !== "") {
      process.env.TMPDIR = envTmp;
    }

    if (opts.mode === "revert") {
      return await revertCmd(opts, manifestPath);
    }

    if (adapters.some((a) => a.harness === "claude")) {
      const problem = validateSource(source);
      if (problem !== null) {
        console.error(`pinga install: ${problem}: ${source}`);
        return INSTALL_EXIT.usage;
      }
    }

    // 1. Manifest e JSON de cada alvo existente do HOME real.
    let manifest: Manifest;
    try {
      manifest = readManifest(manifestPath);
    } catch (e) {
      console.error(`pinga install: ${errorMessage(e)}`);
      return INSTALL_EXIT.config_invalid;
    }

    const targets = [...new Set(adapters.flatMap((a) => a.targets))];
    const beforeByFile = new Map<string, unknown>();
    for (const file of targets) {
      const abs = join(opts.home, file);
      if (!existsSync(abs)) {
        beforeByFile.set(file, undefined);
        continue;
      }
      try {
        beforeByFile.set(file, JSON.parse(readFileSync(abs, "utf8")));
      } catch {
        console.error(`pinga install: JSON ilegível em ${file}`);
        return INSTALL_EXIT.config_invalid;
      }
    }

    let flowExit = 0;
    let renderedDiff = "";
    const infos: TargetInfo[] = [];
    const pendingWrites: PendingWrite[] = [];
    const pendingUnlinks: string[] = [];

    // 2. HOME-sombra: aplica os adaptadores, costura o diff e pega os bytes.
    await withShadow(opts.home, targets, async (shadowHome: string) => {
      for (const adapter of adapters) {
        try {
          await adapter.apply(shadowHome, { source, now });
        } catch (e) {
          if (isConfigInvalid(e)) {
            console.error(`pinga install: ${errorMessage(e)}`);
          } else {
            console.error(
              `pinga install: adaptador ${adapter.harness} falhou: ${errorMessage(e)}`,
            );
          }
          flowExit = isConfigInvalid(e)
            ? INSTALL_EXIT.config_invalid
            : INSTALL_EXIT.infra;
          return;
        }
      }

      // 3. Arquivo novo na sombra fora dos alvos -> foreign_key.
      const foreign = scanForeignFiles(shadowHome, targets);
      if (foreign.length > 0) {
        for (const rel of foreign) {
          console.error(`fora dos alvos: ${rel}`);
        }
        flowExit = INSTALL_EXIT.foreign_key;
        return;
      }

      // 4. Diff por alvo + guarda A2.
      for (const adapter of adapters) {
        for (const file of adapter.targets) {
          const before = beforeByFile.get(file);
          const shadowAbs = join(shadowHome, file);
          if (!existsSync(shadowAbs) && before === undefined) continue;

          let after: unknown;
          if (existsSync(shadowAbs)) {
            try {
              after = JSON.parse(readFileSync(shadowAbs, "utf8"));
            } catch (e) {
              console.error(
                `pinga install: JSON ilegível na sombra em ${file}: ${errorMessage(e)}`,
              );
              flowExit = INSTALL_EXIT.infra;
              return;
            }
          }

          let status: "new" | "removed" | "changed";
          if (before === undefined) status = "new";
          else if (after === undefined) status = "removed";
          else status = "changed";

          const volatile = adapter.volatile[file] ?? [];
          const changes =
            after === undefined && before === undefined
              ? []
              : jsonPointerDiff(before, after, volatile);

          const guard = checkForeign({
            adapter,
            file,
            before,
            after,
            changes,
            manifest,
          });
          if (!guard.ok) {
            console.error(
              `pinga install: chave alheia ou homônima em ${file}: ${guard.pointers.join(", ")}`,
            );
            flowExit = INSTALL_EXIT.foreign_key;
            return;
          }

          infos.push({
            adapter,
            file,
            status,
            before,
            after,
            changes,
            existed: before !== undefined,
          });

          if (changes.length === 0) continue;
          if (after === undefined) {
            pendingUnlinks.push(file);
          } else {
            pendingWrites.push({ file, bytes: readFileSync(shadowAbs) });
          }
        }
      }

      const sectionFiles = new Map<string, FileDiff[]>();
      for (const info of infos) {
        if (info.changes.length === 0) continue;
        const list = sectionFiles.get(info.adapter.harness) ?? [];
        list.push({
          file: info.file,
          status: info.status,
          changes: info.changes,
        });
        sectionFiles.set(info.adapter.harness, list);
      }
      const sections = adapters
        .map((a) => ({
          harness: a.harness,
          files: sectionFiles.get(a.harness) ?? [],
        }));
      renderedDiff = renderDiff(sections);
    });

    if (flowExit !== 0) return flowExit;

    const diffSha = sha256hex(renderedDiff);

    if (opts.mode === "dry-run") {
      writeAtomic(
        planPath,
        JSON.stringify({ diff_sha256: diffSha }, null, 2) + "\n",
      );
      if (renderedDiff !== "") process.stdout.write(renderedDiff);
      return INSTALL_EXIT.ok;
    }

    // 5. --apply: diff vazio -> nada escrito, nem manifest nem backup.
    if (renderedDiff === "") return INSTALL_EXIT.ok;

    let planSha: string | undefined;
    if (existsSync(planPath)) {
      try {
        const parsed = JSON.parse(readFileSync(planPath, "utf8")) as {
          diff_sha256?: unknown;
        };
        if (typeof parsed.diff_sha256 === "string") planSha = parsed.diff_sha256;
      } catch {
        planSha = undefined;
      }
    }
    if (planSha === undefined || planSha !== diffSha) {
      console.error(
        "pinga install: --apply exige um --dry-run prévio com o mesmo diff (revise com pinga install --dry-run)",
      );
      return INSTALL_EXIT.usage;
    }

    // 6. Backup por sha256, cópia atômica sombra -> real por bytes, conferência.
    const applied: Array<{
      info: TargetInfo;
      preSha: string;
      postSha: string;
      backupPath: string;
    }> = [];
    const backupsForRollback: Array<{ file: string; backup_path: string }> = [];

    try {
      mkdirSync(stateDir, { recursive: true });
      for (const write of pendingWrites) {
        const abs = join(opts.home, write.file);
        let backupPath = "";
        let preSha = "absent";
        if (beforeByFile.get(write.file) !== undefined) {
          const backup = backupFile(stateDir, abs);
          preSha = backup.sha256;
          backupPath = backup.backup_path;
          backupsForRollback.push({ file: write.file, backup_path: backupPath });
        }
        writeAtomic(abs, write.bytes);
        const postSha = sha256File(abs);
        const info = infos.find((i) => i.file === write.file)!;
        applied.push({ info, preSha, postSha, backupPath });
      }
      for (const file of pendingUnlinks) {
        const abs = join(opts.home, file);
        const backup = backupFile(stateDir, abs);
        backupsForRollback.push({ file, backup_path: backup.backup_path });
        rmSync(abs, { force: true });
        const info = infos.find((i) => i.file === file)!;
        applied.push({
          info,
          preSha: backup.sha256,
          postSha: sha256File(abs),
          backupPath: backup.backup_path,
        });
      }

      for (const write of pendingWrites) {
        const abs = join(opts.home, write.file);
        const bytesSha = createHash("sha256")
          .update(write.bytes)
          .digest("hex");
        if (sha256File(abs) !== bytesSha) {
          throw new Error(`copia sombra -> real não conferiu para ${write.file}`);
        }
      }
    } catch (e) {
      // Restaura os backups já aplicados.
      for (const { file, backup_path } of backupsForRollback) {
        if (existsSync(backup_path)) {
          writeAtomic(join(opts.home, file), readFileSync(backup_path));
        } else {
          rmSync(join(opts.home, file), { force: true });
        }
      }
      console.error(`pinga install: ${errorMessage(e)}`);
      return INSTALL_EXIT.infra;
    }

    // 7. Manifest atômico.
    const entries = installManifestEntries(manifest, applied, now);
    writeAtomic(
      manifestPath,
      JSON.stringify({ version: 1, entries }, null, 2) + "\n",
    );
    rmSync(planPath, { force: true });
    process.stdout.write(renderedDiff);
    return INSTALL_EXIT.ok;
  } finally {
    if (envTmp !== undefined && envTmp !== "") {
      if (prevTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmp;
    }
  }
}
