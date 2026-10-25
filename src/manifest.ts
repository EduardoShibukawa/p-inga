import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const MANIFEST_VERSION = 1;

export type Harness = "claude" | "pi" | "opencode" | "hermes" | "tuios";

export type ManifestEntry = {
  harness: Harness;
  target_file: string;
  key_path?: string;
  sha256_pre: string;
  sha256_post: string;
  installed_at: string;
  backup_path: string;
  adopted?: boolean;
};

export type Manifest = { version: 1; entries: ManifestEntry[] };

const HARNESS_VALUES: Harness[] = [
  "claude",
  "pi",
  "opencode",
  "hermes",
  "tuios",
];

const HEX64 = /^[0-9a-f]{64}$/;

const ENTRY_KEYS = new Set([
  "harness",
  "target_file",
  "key_path",
  "sha256_pre",
  "sha256_post",
  "installed_at",
  "backup_path",
  "adopted",
]);

export function defaultStateDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const base =
    env.XDG_STATE_HOME && env.XDG_STATE_HOME.length > 0
      ? env.XDG_STATE_HOME
      : join(env.HOME ?? homedir(), ".local/state");
  return join(base, "pinga");
}

export function defaultManifestPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(defaultStateDir(env), "manifest.json");
}

export type ManifestValidation =
  | { ok: true; manifest: Manifest }
  | { ok: false; errors: string[] };

function validateEntry(x: unknown, i: number, errors: string[]): void {
  if (typeof x !== "object" || x === null) {
    errors.push(`entries[${i}]: não é objeto`);
    return;
  }
  const e = x as Record<string, unknown>;
  for (const key of Object.keys(e)) {
    if (!ENTRY_KEYS.has(key)) errors.push(`entries[${i}]: chave desconhecida ${key}`);
  }
  if (typeof e.harness !== "string" || !HARNESS_VALUES.includes(e.harness as Harness)) {
    errors.push(`entries[${i}]: harness inválido`);
  }
  if (typeof e.target_file !== "string" || e.target_file === "") {
    errors.push(`entries[${i}]: target_file deve ser string`);
  }
  if (e.key_path !== undefined && typeof e.key_path !== "string") {
    errors.push(`entries[${i}]: key_path deve ser string`);
  }
  const preOk =
    typeof e.sha256_pre === "string" &&
    (e.sha256_pre === "absent" || HEX64.test(e.sha256_pre));
  if (!preOk) errors.push(`entries[${i}]: sha256_pre inválido`);
  if (typeof e.sha256_post !== "string" || !HEX64.test(e.sha256_post)) {
    errors.push(`entries[${i}]: sha256_post inválido`);
  }
  if (typeof e.installed_at !== "string" || e.installed_at === "") {
    errors.push(`entries[${i}]: installed_at deve ser string`);
  }
  if (typeof e.backup_path !== "string") {
    errors.push(`entries[${i}]: backup_path deve ser string`);
  } else if (e.sha256_pre === "absent" && e.backup_path !== "") {
    errors.push(`entries[${i}]: sha256_pre "absent" exige backup_path ""`);
  } else if (e.sha256_pre !== "absent" && e.backup_path === "") {
    errors.push(`entries[${i}]: backup_path não pode ser vazio`);
  }
  if (e.adopted !== undefined && typeof e.adopted !== "boolean") {
    errors.push(`entries[${i}]: adopted deve ser boolean`);
  }
}

export function validateManifest(x: unknown): ManifestValidation {
  const errors: string[] = [];
  if (typeof x !== "object" || x === null) {
    return { ok: false, errors: ["raiz não é objeto"] };
  }
  const obj = x as Record<string, unknown>;
  if (obj.version !== MANIFEST_VERSION) {
    errors.push(`version deve ser ${MANIFEST_VERSION}`);
  }
  if (!Array.isArray(obj.entries)) {
    errors.push("entries deve ser array");
  } else {
    obj.entries.forEach((entry, i) => validateEntry(entry, i, errors));
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: x as unknown as Manifest };
}

export function readManifest(path: string): Manifest {
  if (!existsSync(path)) return { version: MANIFEST_VERSION, entries: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`manifest ilegível (JSON inválido): ${path}`);
  }
  const validated = validateManifest(parsed);
  if (!validated.ok) {
    throw new Error(`manifest inválido (${path}): ${validated.errors.join("; ")}`);
  }
  return validated.manifest;
}

/** Escrita atômica: arquivo regular (string/bytes) ou symlink (alvo renomeado por cima do arquivo). */
export function writeAtomic(
  path: string,
  bytes: string | Uint8Array | { symlink: string },
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.tmp-${process.pid}-${randomUUID()}`);
  const isSymlink =
    bytes !== null &&
    typeof bytes === "object" &&
    !(bytes instanceof Uint8Array) &&
    "symlink" in bytes;
  try {
    if (isSymlink) {
      symlinkSync((bytes as { symlink: string }).symlink, tmpPath);
    } else {
      writeFileSync(tmpPath, bytes as string | Uint8Array);
    }
    renameSync(tmpPath, path);
  } catch (e) {
    rmSync(tmpPath, { force: true });
    throw e;
  }
}

/**
 * sha256File: symlink -> sha256("symlink:" + readlink) (o conteúdo real fora do
 * HOME pode mudar; a identidade do alvo é o que o manifest controla).
 */
export function sha256File(path: string): string {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return "absent";
  }
  if (st.isSymbolicLink()) {
    return createHash("sha256")
      .update(`symlink:${readlinkSync(path)}`)
      .digest("hex");
  }
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function backupFile(
  stateDir: string,
  absPath: string,
): { sha256: string; backup_path: string } {
  const st = lstatSync(absPath);
  const isSymlink = st.isSymbolicLink();
  const sha256 = sha256File(absPath);
  const backup_path = join(stateDir, "backups", sha256);
  if (!existsSync(backup_path)) {
    // Symlink guarda o texto "symlink:<alvo>"; arquivo regular guarda os bytes
    // (readlinkSync só pode rodar num symlink: EINVAL em arquivo regular).
    writeAtomic(
      backup_path,
      isSymlink ? `symlink:${readlinkSync(absPath)}` : readFileSync(absPath),
    );
  }
  return { sha256, backup_path };
}
