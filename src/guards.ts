export const GUARD_EXIT = {
  tests_frozen_changed: 5,
  scope_drift: 6,
} as const;

export type GuardInput = {
  task: string;
  touch?: string[];
  tests_frozen?: string[];
  changed: string[]; // caminhos relativos à raiz do repo
};
export type GuardResult =
  | { ok: true }
  | {
      ok: false;
      reason_code: "tests_frozen_changed";
      files: string[];
      exit: 5;
    }
  | { ok: false; reason_code: "scope_drift"; files: string[]; exit: 6 };

export function alwaysAllowed(task: string): string[] {
  return [`tasks/${task}/EXEC.md`, `tasks/${task}/EVAL.md`];
}

export function evaluateGuards(input: GuardInput): GuardResult {
  if (input.tests_frozen !== undefined) {
    const files = input.changed
      .filter((f) => input.tests_frozen!.includes(f))
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
    const files = input.changed.filter((f) => !allowed.has(f)).sort();
    if (files.length > 0) {
      return {
        ok: false,
        reason_code: "scope_drift",
        files,
        exit: GUARD_EXIT.scope_drift,
      };
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

export function precommitDecision(staged: string[]): "skip" | "test" {
  if (staged.length > 0 && staged.every((f) => /^(tests|tasks|specs)\//.test(f))) {
    return "skip";
  }
  return "test";
}
