import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const SHADOW_PREFIX = "pinga-shadow-";

/**
 * Helpers de CLI nativo, num módulo folha (sem importar/adaptar os adapters),
 * para evitar ciclo de importação: os adapters precisam deles em runtime e o
 * install os re-exporta.
 */

/**
 * Falha de CLI nativo (exit != 0, spawn ou timeout): erro de infra (exit 8),
 * citando o nome do binário.
 */
export function nativeFailError(
  bin: string,
  args: string[],
  exit: number | null,
): Error {
  const err = new Error(
    `${bin} ${args.join(" ")} falhou (exit ${exit === null ? "timeout" : exit})`,
  ) as Error & { code?: string };
  err.code = "infra";
  return err;
}

/**
 * CLI nativo, só na sombra (D15): amplia o PATH do env (T13 rodar o binário do
 * harness pela ordem ADAPTER_ORDER) e roda com HOME/XDG_* apontando para a
 * sombra. exit null => timeout (PINGA_INSTALL_TIMEOUT_MS) ou spawn falhou.
 */
export function runNative(
  bin: string,
  args: string[],
  shadow: string,
  env: Record<string, string | undefined>,
  timeoutMs: number,
): { exit: number | null; stdout: string; stderr: string } {
  const PATH = env.PATH ?? process.env.PATH ?? "";
  const resolved = Bun.which(bin, { PATH }) ?? bin;
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") childEnv[key] = value;
  }
  childEnv.HOME = shadow;
  childEnv.XDG_CONFIG_HOME = join(shadow, ".config");
  childEnv.XDG_DATA_HOME = join(shadow, ".local/share");
  childEnv.XDG_STATE_HOME = join(shadow, ".local/state");
  childEnv.PI_CODING_AGENT_DIR = join(shadow, ".pi/agent");
  try {
    const res = Bun.spawnSync([resolved, ...args], {
      cwd: shadow,
      timeout: timeoutMs,
      env: childEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exit: res.exitedDueToTimeout ? null : res.exitCode,
      stdout: res.stdout.toString(),
      stderr: res.stderr.toString(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { exit: null, stdout: "", stderr: message };
  }
}

export function installTimeoutMs(
  env: Record<string, string | undefined>,
): number {
  return Number(env.PINGA_INSTALL_TIMEOUT_MS ?? 60000);
}

export type Change = {
  op: "+" | "-" | "~";
  pointer: string;
  before?: unknown;
  after?: unknown;
};

export type FileDiff = {
  file: string;
  status: "new" | "removed" | "changed";
  changes: Change[];
};

/** RFC 6901: "~" -> "~0", "/" -> "~1". */
export function escapePointer(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

type PlainObject = Record<string, unknown>;

/**
 * I16: nada de terceiros deve gravar no HOME em uso. Sob `bun test`, todo
 * filho `bun` herda do pai o cache de transpilação do runtime e grava
 * `.pile` em `$HOME/.bun/install/cache`, poluindo o HOME dos testes. Os
 * spawns da suíte passam `env` explícito, então desabilitar o cache de
 * transpilação nesses spawns mantém o HOME limpo; spawns sem `opts.env`
 * (que herdam o reenv do pai) continuam com o comportamento padrão.
 */
const realSpawnSync = Bun.spawnSync;
type SpawnSyncArgs = Parameters<typeof Bun.spawnSync>;

Bun.spawnSync = function spawnSyncWithoutTranspileCache(
  cmd: SpawnSyncArgs[0],
  opts?: SpawnSyncArgs[1],
): ReturnType<typeof Bun.spawnSync> {
  const patched =
    opts && typeof opts === "object" &&
    opts.env !== undefined && typeof opts.env === "object" &&
    !Array.isArray(opts.env)
      ? {
          ...opts,
          env: {
            ...(opts.env as Record<string, string>),
            BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
          },
        }
      : opts;
  return realSpawnSync.call(Bun, cmd, patched);
} as typeof Bun.spawnSync;

function isContainer(v: unknown): v is PlainObject {
  return typeof v === "object" && v !== null;
}

function byPointer(a: Change, b: Change): number {
  if (a.pointer < b.pointer) return -1;
  if (a.pointer > b.pointer) return 1;
  return 0;
}

type Masked = (ptr: string) => boolean;

function pushLeaf(
  changes: Change[],
  v: unknown,
  ptr: string,
  op: "+" | "-",
  masked: Masked,
): void {
  if (masked(ptr)) return;
  if (op === "+") changes.push({ op, pointer: ptr, after: v });
  else changes.push({ op, pointer: ptr, before: v });
}

/**
 * Documento ausente de um lado (arquivo novo/removido): cada folha do lado
 * presente é `+` (novo) ou `-` (removido) no ponteiro correspondente.
 * Contêiner vazio é folha de si mesmo.
 */
function collectLeavesDoc(
  changes: Change[],
  v: unknown,
  ptr: string,
  op: "+" | "-",
  masked: Masked,
): void {
  if (Array.isArray(v)) {
    if (v.length === 0) {
      pushLeaf(changes, v, ptr, op, masked);
      return;
    }
    for (let i = 0; i < v.length; i++) {
      collectLeavesDoc(changes, v[i], `${ptr}/${i}`, op, masked);
    }
    return;
  }
  if (isContainer(v)) {
    if (Object.keys(v).length === 0) {
      pushLeaf(changes, v, ptr, op, masked);
      return;
    }
    for (const key of Object.keys(v)) {
      collectLeavesDoc(changes, v[key], `${ptr}/${escapePointer(key)}`, op, masked);
    }
    return;
  }
  pushLeaf(changes, v, ptr, op, masked);
}

function walk(
  changes: Change[],
  before: unknown,
  after: unknown,
  ptr: string,
  masked: Masked,
): void {
  if (isContainer(before) && isContainer(after)) {
    if (Array.isArray(before) !== Array.isArray(after)) {
      // Troca de tipo ([] <-> {}): mudança no próprio ponteiro.
      if (!masked(ptr)) changes.push({ op: "~", pointer: ptr, before, after });
      return;
    }
    if (Array.isArray(before)) {
      const len = Math.max(before.length, after.length);
      for (let i = 0; i < len; i++) {
        const p = `${ptr}/${i}`;
        if (i < before.length && i < after.length) {
          walk(changes, before[i], after[i], p, masked);
        } else if (i < after.length) {
          pushLeaf(changes, after[i], p, "+", masked);
        } else {
          pushLeaf(changes, before[i], p, "-", masked);
        }
      }
      return;
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const p = `${ptr}/${escapePointer(key)}`;
      if (key in before && key in after) {
        walk(changes, before[key], after[key], p, masked);
      } else if (key in after) {
        pushLeaf(changes, after[key], p, "+", masked);
      } else {
        pushLeaf(changes, before[key], p, "-", masked);
      }
    }
    return;
  }
  // Pelo menos um lado é escalar: igual -> nada; diferente (ou troca de
  // tipo com contêiner) -> "~" no ponteiro.
  if (isContainer(before) || isContainer(after) || before !== after) {
    if (!masked(ptr)) changes.push({ op: "~", pointer: ptr, before, after });
  }
}

/**
 * Diff por JSON Pointer (RFC 6901), comparando folhas (escalares, `{}` e
 * `[]`); arrays por índice. Ponteiros iguais a, ou descendentes de, algum
 * item de `mask` são ignorados. Resultado ordenado por `pointer`.
 */
export function jsonPointerDiff(
  before: unknown,
  after: unknown,
  mask?: string[],
): Change[] {
  const changes: Change[] = [];
  const maskList = mask ?? [];
  const masked: Masked = (ptr) =>
    maskList.some((m) => ptr === m || ptr.startsWith(`${m}/`));

  if (before === undefined) {
    collectLeavesDoc(changes, after, "", "+", masked);
  } else if (after === undefined) {
    collectLeavesDoc(changes, before, "", "-", masked);
  } else {
    walk(changes, before, after, "", masked);
  }
  return changes.sort(byPointer);
}

/** Cria uma sombra em `mkdtemp`, copia só os alvos existentes e garante limpeza. */
export async function withShadow<T>(
  realHome: string,
  targets: string[],
  fn: (shadow: string) => T | Promise<T>,
): Promise<T> {
  const base =
    process.env.TMPDIR && process.env.TMPDIR.length > 0
      ? process.env.TMPDIR
      : realpathSync(tmpdir());
  const shadow = mkdtempSync(join(realpathSync(base), SHADOW_PREFIX));
  try {
    for (const rel of targets) {
      const src = join(realHome, rel);
      if (!existsSync(src)) continue;
      const dst = join(shadow, rel);
      if (rel.endsWith("/")) {
        // Alvo de diretório (T13): copia recursivamente arquivos e symlinks.
        copyTree(src, dst);
        continue;
      }
      const st = lstatSync(src);
      mkdirSync(dirname(dst), { recursive: true });
      if (st.isSymbolicLink()) {
        symlinkSync(readlinkSync(src), dst);
      } else if (st.isFile()) {
        copyFileSync(src, dst);
      }
    }
    return await fn(shadow);
  } finally {
    rmSync(shadow, { recursive: true, force: true });
  }
}

function copyTree(srcDir: string, dstDir: string): void {
  const st = lstatSync(srcDir);
  if (!st.isDirectory()) return;
  mkdirSync(dstDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const src = join(srcDir, name);
    const dst = join(dstDir, name);
    const st2 = lstatSync(src);
    if (st2.isSymbolicLink()) {
      symlinkSync(readlinkSync(src), dst);
    } else if (st2.isDirectory()) {
      copyTree(src, dst);
    } else if (st2.isFile()) {
      copyFileSync(src, dst);
    }
  }
}

export type DiffSection = {
  harness: string;
  files: FileDiff[];
  skippedReason?: string;
};

export function renderDiff(
  sections: Array<{ harness: string; files: FileDiff[]; skippedReason?: string }>,
): string {
  let out = "";
  for (const section of sections) {
    if (section.files.length === 0 && !section.skippedReason) continue;
    out += section.skippedReason
      ? `=== ${section.harness} (pulado: ${section.skippedReason}) ===\n`
      : `=== ${section.harness} ===\n`;
    for (const file of section.files) {
      if (file.changes.length === 0) continue;
      const tag =
        file.status === "new"
          ? " (novo)"
          : file.status === "removed"
            ? " (removido)"
            : "";
      out += `--- ${file.file}${tag}\n`;
      for (const change of file.changes) {
        if (change.op === "+") {
          out +=
            change.after === undefined
              ? `+ ${change.pointer}\n`
              : `+ ${change.pointer}: ${JSON.stringify(change.after)}\n`;
        } else if (change.op === "-") {
          out += `- ${change.pointer}\n`;
        } else {
          out += `~ ${change.pointer}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}\n`;
        }
      }
    }
  }
  return out;
}
