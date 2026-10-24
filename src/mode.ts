import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { canonicalJson } from "./canonical";
import { changedFiles, findRedBase } from "./guards";
import { parsePlan } from "./plan";

export const MODES = ["mvp", "padrao", "completo"] as const;
export type Mode = (typeof MODES)[number];

export const MODE_RAISED_BY = [
  "requested",
  "diff_touches_migration",
  "diff_touches_auth",
  "diff_touches_public_api",
  "diff_touches_ci",
  "diff_touches_lockfile",
  "night_run",
  "trunk_branch",
  "operator_override",
] as const;
export type ModeRaisedBy = (typeof MODE_RAISED_BY)[number];

export type CriticalRaise = Extract<ModeRaisedBy, `diff_touches_${string}`>;

export const CRITICAL_RULES: ReadonlyArray<{
  raised_by: CriticalRaise;
  patterns: readonly string[];
}> = [
  {
    raised_by: "diff_touches_migration",
    patterns: ["**/migrations/**", "**/migration/**", "**/db/**"],
  },
  {
    raised_by: "diff_touches_auth",
    patterns: ["**/auth/**", "**/security/**"],
  },
  {
    raised_by: "diff_touches_public_api",
    patterns: ["**/api/**", "**/routes/**", "**/openapi.*"],
  },
  {
    raised_by: "diff_touches_ci",
    patterns: [".github/**", "**/Dockerfile"],
  },
  {
    raised_by: "diff_touches_lockfile",
    patterns: [
      "**/bun.lock",
      "**/bun.lockb",
      "**/package-lock.json",
      "**/yarn.lock",
      "**/pnpm-lock.yaml",
      "**/go.sum",
      "**/Cargo.lock",
      "**/poetry.lock",
      "**/uv.lock",
    ],
  },
];

export const TRUNK_BRANCHES: readonly string[] = ["main", "master"];

export function modeRank(m: Mode): number {
  return MODES.indexOf(m);
}

export function maxMode(a: Mode, b: Mode): Mode {
  return modeRank(a) >= modeRank(b) ? a : b;
}

export function matchesPattern(path: string, pattern: string): boolean {
  if (new Bun.Glob(pattern).match(path)) return true;
  if (pattern.startsWith("**/")) {
    return new Bun.Glob(pattern.slice(3)).match(path);
  }
  return false;
}

export function touchesCritical(
  paths: string[],
): { raised_by: CriticalRaise; files: string[] } | null {
  for (const rule of CRITICAL_RULES) {
    const files = new Set<string>();
    for (const path of paths) {
      for (const pattern of rule.patterns) {
        if (matchesPattern(path, pattern)) {
          files.add(path);
          break;
        }
      }
    }
    if (files.size > 0) {
      return { raised_by: rule.raised_by, files: [...files].sort() };
    }
  }
  return null;
}

export function isTrunkOrNight(
  branch: string | null,
  env: Record<string, string | undefined> = process.env,
): "night_run" | "trunk_branch" | null {
  if (env.PINGA_MODE_NIGHT === "1") return "night_run";
  if (branch !== null && TRUNK_BRANCHES.includes(branch)) return "trunk_branch";
  return null;
}

export type ModeOverride = { from: Mode; to: Mode; reason: string };

export function parseOverride(
  mode: string | undefined,
  reason: string | undefined,
):
  | { ok: true; override: { mode: Mode; reason: string } | null }
  | { ok: false; error: string } {
  if (mode === undefined && reason === undefined) {
    return { ok: true, override: null };
  }
  if (mode === undefined || reason === undefined) {
    return { ok: false, error: "--override-mode e --reason devem ser informados juntos" };
  }
  if (!(MODES as readonly string[]).includes(mode)) {
    return { ok: false, error: `override-mode inválido: ${mode}` };
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0 || reason.trim().length > 280) {
    return { ok: false, error: "reason deve ter entre 1 e 280 caracteres" };
  }
  return { ok: true, override: { mode: mode as Mode, reason: trimmed } };
}

export type ModeDecision = {
  requested: Mode;
  effective: Mode;
  raised_by: ModeRaisedBy;
  signals: ModeRaisedBy[];
  override: ModeOverride | null;
};

export function resolveMode(input: {
  requested: Mode;
  paths: string[];
  branch: string | null;
  env?: Record<string, string | undefined>;
  override?: { mode: Mode; reason: string } | null;
}): ModeDecision {
  const signals: ModeRaisedBy[] = [];
  const crit = touchesCritical(input.paths);
  if (crit !== null) {
    for (const rule of CRITICAL_RULES) {
      let matched = false;
      for (const path of input.paths) {
        for (const pattern of rule.patterns) {
          if (matchesPattern(path, pattern)) {
            matched = true;
            break;
          }
        }
        if (matched) break;
      }
      if (matched) signals.push(rule.raised_by);
    }
  }
  const tn = isTrunkOrNight(input.branch, input.env);
  if (tn !== null) signals.push(tn);

  let computed = input.requested;
  if (tn !== null) computed = maxMode(computed, "padrao");
  if (crit !== null) computed = maxMode(computed, "completo");

  let computedRaisedBy: ModeRaisedBy;
  if (computed === input.requested) computedRaisedBy = "requested";
  else if (computed === "completo" && crit !== null) computedRaisedBy = crit.raised_by;
  else computedRaisedBy = tn!;

  if (input.override) {
    return {
      requested: input.requested,
      effective: input.override.mode,
      raised_by: "operator_override",
      signals,
      override: {
        from: computed,
        to: input.override.mode,
        reason: input.override.reason,
      },
    };
  }

  return {
    requested: input.requested,
    effective: computed,
    raised_by: computedRaisedBy,
    signals,
    override: null,
  };
}

export function currentBranch(repoRoot: string): string | null {
  const res = Bun.spawnSync(["git", "symbolic-ref", "--short", "-q", "HEAD"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (res.exitCode !== 0) return null;
  return res.stdout.toString().trim() || null;
}

function findRepoRoot(start: string): string | null {
  const res = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: start,
    stdout: "pipe",
    stderr: "pipe",
  });
  return res.exitCode === 0 ? res.stdout.toString().trim() : null;
}

function inferTaskId(planPath: string): string {
  return basename(dirname(resolve(planPath)));
}

function resolveCommit(repoRoot: string, base: string): string | null {
  const res = Bun.spawnSync(
    ["git", "rev-parse", "--verify", "--quiet", `${base}^{commit}`],
    { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
  );
  if (res.exitCode !== 0) return null;
  const sha = res.stdout.toString().trim();
  return sha.length > 0 ? sha : null;
}

export function modePlan(
  planPath: string,
  opts?: { base?: string; overrideMode?: string; reason?: string },
): number {
  const parsedOverride = parseOverride(opts?.overrideMode, opts?.reason);
  if (!parsedOverride.ok) {
    console.error(parsedOverride.error);
    return 2;
  }

  let raw: string;
  try {
    raw = readFileSync(resolve(planPath), "utf8");
  } catch {
    console.error(`plano não encontrado: ${planPath}`);
    return 3;
  }
  const parsed = parsePlan(raw);
  if (!parsed.ok) {
    console.error(parsed.errors.join("\n"));
    return 3;
  }
  const plan = parsed.plan;

  const planDir = dirname(resolve(planPath));
  const repoRoot = findRepoRoot(planDir) ?? planDir;
  const task = inferTaskId(planPath);

  if (opts?.base !== undefined) {
    if (resolveCommit(repoRoot, opts.base) === null) {
      console.error(`base inválida: ${opts.base}`);
      return 2;
    }
  }
  const baseSha =
    opts?.base !== undefined
      ? resolveCommit(repoRoot, opts.base)
      : findRedBase(repoRoot, task);

  const paths = Array.from(
    new Set([
      ...(plan.touch ?? []),
      ...(baseSha !== null ? changedFiles(repoRoot, baseSha) : []),
    ]),
  );

  const branch = currentBranch(repoRoot);
  const decision = resolveMode({
    requested: plan.mode,
    paths,
    branch,
    env: process.env,
    override: parsedOverride.override,
  });

  process.stdout.write(`${canonicalJson({ task, ...decision })}\n`);
  return 0;
}
