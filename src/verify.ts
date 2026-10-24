import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defaultLedgerPath, openLedger } from "./ledger";
import { changedFiles, evaluateGuards, findRedBase } from "./guards";
import { parsePlan } from "./plan";
import type { ReasonCode, Receipt, Status } from "./receipt";

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function authorFromEnv(): { model: string | null; family: string | null } {
  return {
    model: process.env.PINGA_AUTHOR_MODEL ?? null,
    family: process.env.PINGA_AUTHOR_FAMILY ?? null,
  };
}

export type VerifyOptions = { base?: string };

export function verifyPlan(
  planPath: string,
  ledgerPathArg?: string,
  attemptArg?: number,
  opts?: VerifyOptions,
): number {
  const resolvedPlanPath = resolve(planPath);
  const task = basename(dirname(resolvedPlanPath));

  const gitRoot = Bun.spawnSync(
    ["git", "rev-parse", "--show-toplevel"],
    {
      cwd: dirname(resolvedPlanPath),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const repoRoot =
    gitRoot.exitCode === 0
      ? gitRoot.stdout.toString().trim()
      : dirname(resolvedPlanPath);

  // Validação de --base: nenhuma gravação no ledger antes de OK.
  let resolvedBase: string | undefined;
  if (opts?.base !== undefined) {
    const check = Bun.spawnSync(
      [
        "git",
        "rev-parse",
        "--verify",
        "--quiet",
        `${opts.base}^{commit}`,
      ],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    if (check.exitCode !== 0) {
      console.error(`base inválida: ${opts.base}`);
      return 2;
    }
    resolvedBase = opts.base;
  }

  const ledger = openLedger(ledgerPathArg ?? defaultLedgerPath());

  try {
    const attempt =
      attemptArg ??
      1 + ledger.all().filter((row) => row.task === task).length;

    const parsed = parsePlan(readFileSync(resolvedPlanPath, "utf8"));

    if (!parsed.ok) {
      const receipt: Receipt = {
        v: 1,
        type: "task.receipt",
        id: randomUUID(),
        task,
        status: "blocked",
        reason_code: "plan_invalid",
        attempts: attempt,
        evidence: [],
        tokens: { in: null, out: null, cache: null, source: null },
        cost_usd: null,
        cost_evidence: "not run",
        author: authorFromEnv(),
        verified_by: null,
        summary: `${task} blocked: plano inválido (${parsed.errors[0]})`.slice(
          0,
          280,
        ),
        created_at: new Date().toISOString(),
      };
      ledger.append(receipt);
      console.log(JSON.stringify(receipt));
      return 3;
    }

    const plan = parsed.plan;

    const baseSha = resolvedBase ?? findRedBase(repoRoot, task);
    if (baseSha !== null) {
      const changed = changedFiles(repoRoot, baseSha);
      const guardRes = evaluateGuards({
        task,
        touch: plan.touch,
        tests_frozen: plan.tests_frozen,
        changed,
      });
      if (!guardRes.ok) {
        const summary =
          guardRes.reason_code === "tests_frozen_changed"
            ? `${task} blocked: tests_frozen alterado (${guardRes.files.join(", ")})`
            : `${task} blocked: fora do touch (${guardRes.files.join(", ")})`;
        const receipt: Receipt = {
          v: 1,
          type: "task.receipt",
          id: randomUUID(),
          task,
          status: "blocked",
          reason_code: guardRes.reason_code,
          attempts: attempt,
          evidence: [],
          tokens: { in: null, out: null, cache: null, source: null },
          cost_usd: null,
          cost_evidence: "not run",
          author: authorFromEnv(),
          verified_by: null,
          summary: summary.slice(0, 280),
          created_at: new Date().toISOString(),
        };
        ledger.append(receipt);
        console.log(JSON.stringify(receipt));
        return guardRes.exit;
      }
    }

    const timeoutMs = process.env.PINGA_TIMEOUT_MS
      ? Number(process.env.PINGA_TIMEOUT_MS)
      : plan.budget?.minutes
        ? plan.budget.minutes * 60_000
        : 30 * 60_000;

    const t0 = Date.now();
    const res = Bun.spawnSync(["sh", "-c", plan.done_when], {
      cwd: repoRoot,
      timeout: timeoutMs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const duration_ms = Math.max(0, Date.now() - t0);

    const outBuffer = Buffer.concat([res.stdout as Uint8Array, res.stderr as Uint8Array]);
    const attemptDir = join(repoRoot, "runs", task, String(attempt));
    mkdirSync(attemptDir, { recursive: true });
    writeFileSync(join(attemptDir, "out.txt"), outBuffer);

    const outSha256 = sha256hex(outBuffer);
    const cmdSha256 = sha256hex(plan.done_when);
    const timedOut = Boolean(res.exitedDueToTimeout || res.exitCode === null);

    let status: Status;
    let reason_code: ReasonCode | null;
    let evidenceExit: number | null;
    let cliExit: number;

    if (timedOut) {
      status = "blocked";
      reason_code = "budget";
      evidenceExit = null;
      cliExit = 2;
    } else if (res.exitCode === 0) {
      status = "pass";
      reason_code = null;
      evidenceExit = 0;
      cliExit = 0;
    } else {
      status = "fail";
      reason_code = "command_failed";
      evidenceExit = res.exitCode;
      cliExit = 1;
    }

    const segundos = Math.round(duration_ms / 1000);

    const receipt: Receipt = {
      v: 1,
      type: "task.receipt",
      id: randomUUID(),
      task,
      status,
      reason_code,
      attempts: attempt,
      evidence: [
        {
          kind: "command",
          cmd_sha256: cmdSha256,
          exit: evidenceExit,
          duration_ms,
          artifact_ref: {
            path: `runs/${task}/${attempt}/out.txt`,
            sha256: outSha256,
          },
        },
      ],
      tokens: { in: null, out: null, cache: null, source: null },
      cost_usd: null,
      cost_evidence: "not run",
      author: authorFromEnv(),
      verified_by: null,
      summary: `${task} ${status}: done_when exit ${evidenceExit} em ${segundos}s`.slice(
        0,
        280,
      ),
      created_at: new Date().toISOString(),
    };

    ledger.append(receipt);
    console.log(JSON.stringify(receipt));
    return cliExit;
  } finally {
    ledger.close();
  }
}
