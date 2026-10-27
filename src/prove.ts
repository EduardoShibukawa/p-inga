import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { holdoutRunnerPath, runHoldout } from "./examples";
import { findRedBase } from "./guards";
import { defaultLedgerPath, openLedger } from "./ledger";
import { parsePlan } from "./plan";
import type { Plan } from "./plan";
import type { Evidence, ReasonCode, Receipt, Status } from "./receipt";
import { receiptKind } from "./receipt";
import { NOT_RUN_TOKENS } from "./tokens";

/**
 * O git exporta variáveis de contexto de repositorio para os hooks (ex.:
 * GIT_INDEX_FILE=.git/index em `git commit`). Herdar essas variáveis em
 * subprocessos executados em OUTRO repo (os repos temporários dos testes e
 * `git worktree add`) quebra o git, então removemos antes de cada spawn.
 */
const GIT_CONTEXT_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_PREFIX",
];

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !GIT_CONTEXT_ENV_KEYS.includes(key)) {
      env[key] = value;
    }
  }
  return env;
}

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function authorFromEnv(): { model: string | null; family: string | null } {
  return {
    model: process.env.PINGA_AUTHOR_MODEL ?? null,
    family: process.env.PINGA_AUTHOR_FAMILY ?? null,
  };
}

export const PROVE_EXIT = { proved: 0, infra: 8, test_passed_on_base: 10 } as const;
export const WORKTREE_PREFIX = "pinga-prove-";

export type ProofVerdict = "proved" | "test_passed_on_base" | "inconclusive";

/** Saída típica de falha de resolução/compilação (bun, TS, Go). */
const RESOLUTION_FAILURE = [
  /Cannot find module/i,
  /Module not found/i,
  /Cannot find name '/,
  /error TS2(304|305|307|552|724)\b/,
  /(^|\s)undefined: \w/m,
  /no required module provides package/,
  /cannot find package/,
  /\[build failed\]/,
  /\[setup failed\]/,
];
/** Marcadores de falha de asserção: se presentes, o RED é real. */
const ASSERTION_FAILURE = [
  /expect\(/,
  /^\s*Expected:/m,
  /^\s*Received:/m,
  /AssertionError/,
  /^--- FAIL: /m,
];
export const WEAK_RED_DETAIL = "RED por erro de import/compilação, não por asserção";

export function isResolutionFailure(output: string): boolean {
  return (
    RESOLUTION_FAILURE.some((re) => re.test(output)) &&
    !ASSERTION_FAILURE.some((re) => re.test(output))
  );
}

export function classifyBaseRun(r: {
  exit: number | null;
  timedOut: boolean;
  output?: string;
}): ProofVerdict {
  if (r.timedOut || r.exit === null || r.exit === 126 || r.exit === 127) {
    return "inconclusive";
  }
  if (r.exit === 0) return "test_passed_on_base";
  if (r.output !== undefined && isResolutionFailure(r.output)) {
    return "inconclusive";
  }
  return "proved";
}

export function combineProof(
  doneWhen: ProofVerdict,
  holdout: ProofVerdict | null,
): { verdict: ProofVerdict; which: "done_when" | "holdout" | null } {
  if (doneWhen === "test_passed_on_base") {
    return { verdict: "test_passed_on_base", which: "done_when" };
  }
  if (holdout === "test_passed_on_base") {
    return { verdict: "test_passed_on_base", which: "holdout" };
  }
  if (doneWhen === "inconclusive") {
    return { verdict: "inconclusive", which: "done_when" };
  }
  if (holdout === "inconclusive") {
    return { verdict: "inconclusive", which: "holdout" };
  }
  return { verdict: "proved", which: null };
}

export function resolveProofBase(
  repoRoot: string,
  task: string,
  base?: string,
): { ok: true; sha: string } | { ok: false; error: string } {
  if (base !== undefined) {
    const check = Bun.spawnSync(
      ["git", "rev-parse", "--verify", "--quiet", `${base}^{commit}`],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe", env: cleanEnv() },
    );
    if (check.exitCode !== 0) {
      return { ok: false, error: `base inválida: ${base}` };
    }
    return { ok: true, sha: check.stdout.toString().trim() };
  }
  const sha = findRedBase(repoRoot, task);
  if (sha === null) {
    return { ok: false, error: `sem base para ${task}` };
  }
  return { ok: true, sha };
}

export function sweepStaleWorktrees(repoRoot: string): string[] {
  const removed: string[] = [];
  const targetPrefix = join(realpathSync(tmpdir()), WORKTREE_PREFIX);

  try {
    const list = Bun.spawnSync(
      ["git", "worktree", "list", "--porcelain"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe", env: cleanEnv() },
    );
    if (list.exitCode === 0) {
      const wtPaths = list.stdout
        .toString()
        .split("\n")
        .filter((l) => l.startsWith("worktree "))
        .map((l) => l.slice("worktree ".length).trim());
      // A primeira worktree listada é a principal; nunca é tocada.
      for (const wtPath of wtPaths.slice(1)) {
        if (!wtPath.startsWith(targetPrefix)) continue;
        const parent = dirname(wtPath);
        if (
          existsSync(wtPath) ||
          (parent.startsWith(targetPrefix) && existsSync(parent))
        ) {
          try {
            Bun.spawnSync(
              ["git", "worktree", "remove", "--force", wtPath],
              { cwd: repoRoot, stdout: "pipe", stderr: "pipe", env: cleanEnv() },
            );
          } catch {}
          if (parent.startsWith(targetPrefix)) {
            try {
              rmSync(parent, { recursive: true, force: true });
            } catch {}
          }
          removed.push(wtPath);
        }
      }
    }
  } catch {}

  try {
    Bun.spawnSync(["git", "worktree", "prune"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: cleanEnv(),
    });
  } catch {}

  return removed.sort();
}

export function withTempWorktree<T>(
  repoRoot: string,
  sha: string,
  fn: (path: string) => T,
): T {
  const parentDir = mkdtempSync(join(realpathSync(tmpdir()), WORKTREE_PREFIX));
  const wtPath = join(parentDir, "wt");

  const cleanup = (): void => {
    try {
      Bun.spawnSync(
        ["git", "worktree", "remove", "--force", wtPath],
        { cwd: repoRoot, stdout: "pipe", stderr: "pipe", env: cleanEnv() },
      );
    } catch {}
    try {
      rmSync(parentDir, { recursive: true, force: true });
    } catch {}
    try {
      Bun.spawnSync(["git", "worktree", "prune"], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: cleanEnv(),
      });
    } catch {}
  };
  const onSignal = (code: number) => () => {
    cleanup();
    process.exit(code);
  };
  const onSigint = onSignal(130);
  const onSigterm = onSignal(143);
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    const add = Bun.spawnSync(
      ["git", "worktree", "add", "--detach", "-q", wtPath, sha],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe", env: cleanEnv() },
    );
    if (add.exitCode !== 0) {
      throw new Error(
        `git worktree add falhou: ${add.stderr.toString().trim()}`,
      );
    }
    return fn(wtPath);
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    cleanup();
  }
}

export type ProofResult = {
  verdict: ProofVerdict;
  which: "done_when" | "holdout" | null;
  base: string;
  evidence: Evidence[];
  detail: string;
};

export function proveBase(
  repoRoot: string,
  task: string,
  plan: Plan,
  sha: string,
  n: number,
  timeoutMs: number,
): ProofResult {
  sweepStaleWorktrees(repoRoot);

  return withTempWorktree(repoRoot, sha, (wtPath) => {
    // Overlay: código do base + testes congelados da árvore de trabalho.
    for (const relPath of plan.tests_frozen ?? []) {
      const src = join(repoRoot, relPath);
      if (existsSync(src)) {
        const dest = join(wtPath, relPath);
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
      }
    }

    const firstTest = plan.tests_frozen?.[0];
    if (firstTest === undefined || !existsSync(join(wtPath, firstTest))) {
      return {
        verdict: "inconclusive",
        which: "done_when",
        base: sha,
        evidence: [],
        detail: `teste ausente no base (${firstTest ?? "(sem tests_frozen)"})`,
      };
    }

    const t0 = Date.now();
    const res = Bun.spawnSync(["sh", "-c", plan.done_when], {
      cwd: wtPath,
      timeout: timeoutMs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const duration_ms = Math.max(0, Date.now() - t0);
    const timedOut = Boolean(res.exitedDueToTimeout || res.exitCode === null);

    const outBuffer = Buffer.concat([
      res.stdout as Uint8Array,
      res.stderr as Uint8Array,
    ]);
    const artifactRel = `runs/${task}/prove-${n}/out.txt`;
    const artifactAbs = join(repoRoot, artifactRel);
    mkdirSync(dirname(artifactAbs), { recursive: true });
    writeFileSync(artifactAbs, outBuffer);

    const evidence: Evidence[] = [
      {
        kind: "command",
        cmd_sha256: sha256hex(plan.done_when),
        exit: timedOut ? null : res.exitCode,
        duration_ms,
        artifact_ref: { path: artifactRel, sha256: sha256hex(outBuffer) },
      },
    ];
    const outText = outBuffer.toString("utf8");
    const dwVerdict = classifyBaseRun({
      exit: timedOut ? null : res.exitCode,
      timedOut,
      output: outText,
    });
    const weakRed =
      !timedOut && res.exitCode !== 0 && isResolutionFailure(outText);

    const hRun = runHoldout(repoRoot, task, `prove-${n}`, timeoutMs, {
      cwd: wtPath,
    });
    let hoVerdict: ProofVerdict | null = null;
    if (hRun !== null) {
      evidence.push({
        kind: "command",
        cmd_sha256: sha256hex(`bun test ./${holdoutRunnerPath(task)}`),
        exit: hRun.exit,
        duration_ms: hRun.duration_ms,
        artifact_ref: hRun.artifact,
      });
      hoVerdict = classifyBaseRun({ exit: hRun.exit, timedOut: hRun.timedOut });
    }

    const comb = combineProof(dwVerdict, hoVerdict);
    const detail = timedOut
      ? "timeout"
      : weakRed && comb.which === "done_when"
        ? `${WEAK_RED_DETAIL}; exit ${evidence[0].exit}`
        : `exit ${evidence[0].exit}`;
    return {
      verdict: comb.verdict,
      which: comb.which,
      base: sha,
      evidence,
      detail,
    };
  });
}

export function provePlan(
  planPath: string,
  opts?: { ledgerPath?: string; base?: string },
): number {
  const resolvedPlanPath = resolve(planPath);
  const task = basename(dirname(resolvedPlanPath));

  let planText: string;
  try {
    planText = readFileSync(resolvedPlanPath, "utf8");
  } catch (err) {
    console.error(`plano ilegível: ${(err as Error).message}`);
    return 3;
  }
  const parsed = parsePlan(planText);
  if (!parsed.ok) {
    for (const e of parsed.errors) console.error(e);
    return 3;
  }
  const plan = parsed.plan;

  const gitRoot = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: dirname(resolvedPlanPath),
    stdout: "pipe",
    stderr: "pipe",
    env: cleanEnv(),
  });
  const repoRoot =
    gitRoot.exitCode === 0
      ? gitRoot.stdout.toString().trim()
      : dirname(resolvedPlanPath);

  const baseRes = resolveProofBase(repoRoot, task, opts?.base);
  if (!baseRes.ok) {
    console.error(baseRes.error);
    return 2;
  }

  const ledger = openLedger(opts?.ledgerPath ?? defaultLedgerPath());
  try {
    const n =
      1 +
      ledger
        .all()
        .filter(
          (r) =>
            r.task === task &&
            receiptKind(JSON.parse(r.body) as Receipt) === "prove_red",
        ).length;

    const timeoutMs = process.env.PINGA_TIMEOUT_MS
      ? Number(process.env.PINGA_TIMEOUT_MS)
      : plan.budget?.minutes
        ? plan.budget.minutes * 60_000
        : 30 * 60_000;

    const proof = proveBase(repoRoot, task, plan, baseRes.sha, n, timeoutMs);

    let status: Status;
    let reason_code: ReasonCode | null;
    let cliExit: number;
    let nextAction: string | null = null;
    let summary: string;
    const sha7 = baseRes.sha.slice(0, 7);

    if (proof.verdict === "proved") {
      status = "pass";
      reason_code = null;
      cliExit = 0;
      summary =
        `${task} pass: RED falha no base ${sha7} (done_when exit ${proof.evidence[0]?.exit})`.slice(
          0,
          280,
        );
    } else if (proof.verdict === "test_passed_on_base") {
      status = "blocked";
      reason_code = "test_passed_on_base";
      cliExit = PROVE_EXIT.test_passed_on_base;
      nextAction = "reescrever o RED";
      summary =
        `${task} blocked: ${proof.which} passa no base ${sha7}; o teste não prova nada novo`.slice(
          0,
          280,
        );
    } else {
      status = "not run";
      reason_code = "infra";
      cliExit = PROVE_EXIT.infra;
      summary =
        `${task} not run: prova inconclusiva no base ${sha7} (${proof.detail})`.slice(
          0,
          280,
        );
    }

    const receipt: Receipt = {
      v: 1,
      type: "task.receipt",
      id: randomUUID(),
      task,
      status,
      reason_code,
      attempts: n,
      evidence: proof.evidence,
      tokens: NOT_RUN_TOKENS.tokens,
      cost_usd: null,
      cost_evidence: "not run",
      author: authorFromEnv(),
      verified_by: null,
      flow: "prove_red",
      base_ref: baseRes.sha,
      ...(nextAction !== null ? { next_action: nextAction } : {}),
      summary,
      created_at: new Date().toISOString(),
    };

    ledger.append(receipt);
    console.log(JSON.stringify(receipt));
    return cliExit;
  } finally {
    ledger.close();
  }
}
