import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type DriftBaseline = Record<string, string | null>;

export const GUARD_EXIT = {
  tests_frozen_changed: 5,
  scope_drift: 6,
} as const;

/**
 * Exit próprio do `delta_no_touch`, fora de `GUARD_EXIT` porque aquele shape é
 * contrato congelado (tests/guards.test.ts fixa exatamente 5 e 6).
 */
export const DELTA_NO_TOUCH_EXIT = 7;

export type GuardInput = {
  task: string;
  touch?: string[];
  tests_frozen?: string[];
  changed: string[]; // caminhos relativos à raiz do repo
  /** Exige trabalho real: recibo autônomo não pode sair sem delta no `touch`. */
  requireDelta?: boolean;
  /** Desarma `delta_no_touch` (operador declara trabalho já existente). */
  allowNoDelta?: boolean;
};
export type GuardResult =
  | { ok: true }
  | {
      ok: false;
      reason_code: "tests_frozen_changed";
      files: string[];
      exit: 5;
    }
  | { ok: false; reason_code: "scope_drift"; files: string[]; exit: 6 }
  | { ok: false; reason_code: "delta_no_touch"; files: string[]; exit: 7 };

export function alwaysAllowed(task: string): string[] {
  return [`tasks/${task}/EXEC.md`, `tasks/${task}/EVAL.md`];
}

export function isProvisionalTest(path: string): boolean {
  if (typeof path !== "string") return false;
  const trimmed = path.trim();
  if (trimmed === "") return false;

  // Normaliza separadores e remove segmentos "."; rejeita escapes ("..").
  const rawSegments = trimmed.replace(/\\/g, "/").split("/");
  if (rawSegments.some((s) => s === "..")) return false;
  const segments = rawSegments.filter((s) => s !== "" && s !== ".");
  if (segments.length === 0) return false;
  const normalized = segments.join("/");
  if (normalized.startsWith("/") || normalized.includes("../")) return false;

  const base = segments[segments.length - 1];

  // Diretórios formais de scratchpad TDD.
  if (normalized.startsWith("tests/provisional/")) return true;
  if (normalized.startsWith("tests/scratch/")) return true;
  if (normalized.startsWith(".pinga/scratch/")) return true;

  // Prefixos/sufixos determinísticos no nome do arquivo.
  if (base.startsWith("scratch_")) return true;
  if (base.startsWith("test_scratch_")) return true;
  if (base.includes(".scratch.")) return true;

  return false;
}

export function evaluateGuards(input: GuardInput): GuardResult {
  if (input.tests_frozen !== undefined) {
    const files = input.changed
      .filter((f) => input.tests_frozen!.includes(f) && !isProvisionalTest(f))
      .sort();
    if (files.length > 0) {
      return {
        ok: false,
        reason_code: "tests_frozen_changed",
        files,
        exit: GUARD_EXIT.tests_frozen_changed,
      };
    }
  }

  if (input.touch !== undefined) {
    const allowed = new Set([...input.touch, ...alwaysAllowed(input.task)]);
    const files = input.changed
      .filter((f) => !allowed.has(f) && !isProvisionalTest(f))
      .sort();
    if (files.length > 0) {
      return {
        ok: false,
        reason_code: "scope_drift",
        files,
        exit: GUARD_EXIT.scope_drift,
      };
    }

    // Recibo exige trabalho: nenhum arquivo do próprio `touch` mudou desde o
    // claim => o contrato já estava satisfeito antes desta tentativa. Metadado
    // EXEC/EVAL da própria task contam como delta (contrato de tests/guards.test.ts);
    // teste provisório não conta. Sem nenhum arquivo declarado — nem metadado — o
    // recibo é `delta_no_touch`: nada foi entregue nesta fatia.
    // Só quem declara `requireDelta` (sealing autônomo, ex.: cron da fila) sofre a
    // régua: `verify` manual continua aceitando no-op — contrato de tests/guards.test.ts.
    if (
      input.requireDelta === true &&
      input.allowNoDelta !== true &&
      input.touch.length > 0
    ) {
      const declared = new Set([...input.touch, ...alwaysAllowed(input.task)]);
      const delta = input.changed.filter(
        (f) => declared.has(f) && !isProvisionalTest(f),
      );
      if (delta.length === 0) {
        return {
          ok: false,
          reason_code: "delta_no_touch",
          files: [],
          exit: DELTA_NO_TOUCH_EXIT,
        };
      }
    }
  }

  return { ok: true };
}

export function findRedBase(repoRoot: string, task: string): string | null {
  const log = Bun.spawnSync(["git", "log", "--format=%H%x09%s"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (log.exitCode !== 0) return null;

  const prefix = `test(${task}): RED`;
  const lines = log.stdout.toString().split("\n");
  for (const line of lines) {
    if (line.length === 0) continue;
    const sep = line.indexOf("\t");
    if (sep === -1) continue;
    const subject = line.slice(sep + 1);
    if (subject.startsWith(prefix)) {
      const sha = line.slice(0, sep);
      if (/^[0-9a-f]{40}$/.test(sha)) return sha;
    }
  }
  return null;
}

export function changedFiles(repoRoot: string, base: string): string[] {
  const files = new Set<string>();

  const diff = Bun.spawnSync(
    ["git", "diff", "--name-only", "--no-renames", base],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  if (diff.exitCode === 0) {
    for (const line of diff.stdout.toString().split("\n")) {
      if (line.length > 0) files.add(line);
    }
  }

  const others = Bun.spawnSync(
    ["git", "ls-files", "--others", "--exclude-standard"],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  if (others.exitCode === 0) {
    for (const line of others.stdout.toString().split("\n")) {
      if (line.length > 0) files.add(line);
    }
  }

  return Array.from(files).sort();
}

export function applyBaseline(
  repoRoot: string,
  changed: string[],
  baseline: DriftBaseline,
): string[] {
  return changed.filter((rel) => {
    if (!(rel in baseline)) return true;
    return fileDigest(repoRoot, rel) !== baseline[rel];
  });
}

export function fileDigest(repoRoot: string, rel: string): string | null {
  try {
    const abs = join(repoRoot, rel);
    if (!statSync(abs).isFile()) return null;
    return createHash("sha256").update(readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}

export function precommitDecision(staged: string[]): "skip" | "test" {
  if (staged.length > 0 && staged.every((f) => /^(tests|tasks|specs)\//.test(f))) {
    return "skip";
  }
  return "test";
}
