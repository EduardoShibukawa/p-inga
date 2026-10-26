import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  BREAKER_EXIT,
  BREAKER_NEXT_ACTION,
  computeFailureSignature,
  lastReceiptFor,
  shouldTrip,
} from "./breaker";
import { defaultLedgerPath, openLedger } from "./ledger";
import { notifyReceipt } from "./discord";
import { OVERFIT_EXIT, holdoutRunnerPath, runHoldout } from "./examples";
import { changedFiles, evaluateGuards, findRedBase } from "./guards";
import { currentBranch, parseOverride, resolveMode } from "./mode";
import type { ModeDecision } from "./mode";
import { parsePlan } from "./plan";
import { PROVE_EXIT, proveBase } from "./prove";
import type { ReasonCode, Receipt, Status } from "./receipt";
import { resolveUsageFile, tokenFieldsFor } from "./tokens";
import type { TokenFields } from "./tokens";

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function authorFromEnv(): { model: string | null; family: string | null } {
  return {
    model: process.env.PINGA_AUTHOR_MODEL ?? null,
    family: process.env.PINGA_AUTHOR_FAMILY ?? null,
  };
}

export type VerifyOptions = {
  base?: string;
  usageFile?: string;
  overrideMode?: string;
  reason?: string;
  proveBase?: boolean;
};

function tokenFieldsFromOptions(opts?: VerifyOptions): TokenFields {
  const usagePath = resolveUsageFile(opts?.usageFile);
  const tf = tokenFieldsFor(usagePath);
  if (tf.cost_evidence.startsWith("invalid:")) {
    console.error(`usage warning: ${tf.cost_evidence}`);
  }
  return tf;
}

export function verifyPlan(
  planPath: string,
  ledgerPathArg?: string,
  attemptArg?: number,
  opts?: VerifyOptions,
): number {
  const resolvedPlanPath = resolve(planPath);
  if (!existsSync(resolvedPlanPath)) {
    console.error(`Erro: arquivo de plano não encontrado em ${resolvedPlanPath}`);
    return 3;
  }
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

  const parsedOverride = parseOverride(opts?.overrideMode, opts?.reason);
  if (!parsedOverride.ok) {
    console.error(parsedOverride.error);
    return 2;
  }

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

  // --prove-base exige uma base resolvível: sem recibo se não houver.
  if (opts?.proveBase === true) {
    const baseShaEarly = resolvedBase ?? findRedBase(repoRoot, task);
    if (baseShaEarly === null) {
      console.error("sem base");
      return 2;
    }
  }

  const ledger = openLedger(ledgerPathArg ?? defaultLedgerPath());

  try {
    const attempt =
      attemptArg ??
      1 + ledger.all().filter((row) => row.task === task).length;

    const parsed = parsePlan(readFileSync(resolvedPlanPath, "utf8"));

    if (!parsed.ok) {
      const tf = tokenFieldsFromOptions(opts);
      const receipt: Receipt = {
        v: 1,
        type: "task.receipt",
        id: randomUUID(),
        task,
        status: "blocked",
        reason_code: "plan_invalid",
        attempts: attempt,
        evidence: [],
        tokens: tf.tokens,
        cost_usd: tf.cost_usd,
        cost_evidence: tf.cost_evidence,
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
    const changed = baseSha !== null ? changedFiles(repoRoot, baseSha) : [];

    // Decisão de modo: todo recibo gerado a partir daqui carrega os campos.
    const decision: ModeDecision = resolveMode({
      requested: plan.mode,
      paths: Array.from(new Set([...(plan.touch ?? []), ...changed])),
      branch: currentBranch(repoRoot),
      env: process.env,
      override: parsedOverride.override,
    });
    const modeFields = {
      mode_effective: decision.effective,
      mode_raised_by: decision.raised_by,
      ...(decision.override !== null
        ? { mode_override: decision.override }
        : {}),
    };

    if (baseSha !== null) {
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
        const tf = tokenFieldsFromOptions(opts);
        const receipt: Receipt = {
          v: 1,
          type: "task.receipt",
          id: randomUUID(),
          task,
          status: "blocked",
          reason_code: guardRes.reason_code,
          attempts: attempt,
          evidence: [],
          tokens: tf.tokens,
          cost_usd: tf.cost_usd,
          cost_evidence: tf.cost_evidence,
          author: authorFromEnv(),
          verified_by: null,
          ...modeFields,
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

    // I15: prova no base, antes de rodar o done_when no repo principal.
    // Roda quando o modo efetivo é "completo" ou com --prove-base.
    let provedBaseRef: string | null = null;
    if (decision.effective === "completo" || opts?.proveBase === true) {
      if (baseSha === null) {
        // Só chega aqui em "completo" sem --prove-base (este já saiu com 2 antes).
        console.error("prova no base pulada: sem commit RED");
      } else {
        const proof = proveBase(repoRoot, task, plan, baseSha, attempt, timeoutMs);
        if (proof.verdict !== "proved") {
          const inconclusive = proof.verdict === "inconclusive";
          const sha7 = baseSha.slice(0, 7);
          const blockStatus: Status = inconclusive ? "not run" : "blocked";
          const blockReason: ReasonCode = inconclusive
            ? "infra"
            : "test_passed_on_base";
          const summary = inconclusive
            ? `${task} not run: prova inconclusiva no base ${sha7} (${proof.detail})`.slice(
                0,
                280,
              )
            : `${task} blocked: ${proof.which} passa no base ${sha7}; o teste não prova nada novo`.slice(
                0,
                280,
              );
          const tf = tokenFieldsFromOptions(opts);
          const receipt: Receipt = {
            v: 1,
            type: "task.receipt",
            id: randomUUID(),
            task,
            status: blockStatus,
            reason_code: blockReason,
            attempts: attempt,
            evidence: proof.evidence,
            tokens: tf.tokens,
            cost_usd: tf.cost_usd,
            cost_evidence: tf.cost_evidence,
            author: authorFromEnv(),
            verified_by: null,
            ...modeFields,
            base_ref: baseSha,
            ...(inconclusive ? {} : { next_action: "reescrever o RED" }),
            summary,
            created_at: new Date().toISOString(),
          };
          ledger.append(receipt);
          console.log(JSON.stringify(receipt));
          return inconclusive
            ? PROVE_EXIT.infra
            : PROVE_EXIT.test_passed_on_base;
        }
        provedBaseRef = baseSha;
      }
    }

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
    let breaker: Receipt["breaker"];
    let summary: string;
    let holdoutEvidence: Evidence | null = null;

    const segundos = Math.round(duration_ms / 1000);
    const normalSummary = () =>
      `${task} ${status}: done_when exit ${evidenceExit} em ${segundos}s`.slice(
        0,
        280,
      );

    if (timedOut) {
      status = "blocked";
      reason_code = "budget";
      evidenceExit = null;
      cliExit = 2;
      summary = normalSummary();
    } else if (res.exitCode === 0) {
      status = "pass";
      reason_code = null;
      evidenceExit = 0;
      cliExit = 0;
      summary = normalSummary();

      // Holdout reservado (I13/I14): só roda quando o done_when terminou
      // exit 0 e sem timeout. Sem store para (repo, task), recibo igual ao
      // de antes (evidence com 1 item).
      const hRun = runHoldout(repoRoot, task, attempt, timeoutMs);
      if (hRun !== null) {
        holdoutEvidence = {
          kind: "command",
          cmd_sha256: sha256hex(`bun test ./${holdoutRunnerPath(task)}`),
          exit: hRun.exit,
          duration_ms: hRun.duration_ms,
          artifact_ref: hRun.artifact,
        };
        if (hRun.timedOut) {
          status = "blocked";
          reason_code = "budget";
          cliExit = 2;
          summary =
            `${task} blocked: holdout timeout em ${Math.round(hRun.duration_ms / 1000)}s`.slice(
              0,
              280,
            );
        } else if (hRun.exit === 0) {
          summary = `${normalSummary()} · holdout ok`.slice(0, 280);
        } else {
          const sig = computeFailureSignature({
            exit: hRun.exit,
            out_sha256: hRun.artifact.sha256,
            reason_code: "overfit_holdout",
          });
          const prev = lastReceiptFor(ledger, task);
          if (shouldTrip(prev, sig)) {
            status = "blocked";
            reason_code = "breaker_same_failure";
            cliExit = BREAKER_EXIT;
            breaker = { tripped: true, failure_signature: sig };
            summary =
              `${task} blocked: disjuntor armado, mesma falha 2x seguidas (holdout exit ${hRun.exit}); escalar ao dono`.slice(
                0,
                280,
              );
          } else {
            status = "fail";
            reason_code = "overfit_holdout";
            cliExit = OVERFIT_EXIT;
            breaker = { tripped: false, failure_signature: sig };
            summary =
              `${task} fail: visíveis passam, holdout falhou (overfit ao contrato visível)`.slice(
                0,
                280,
              );
          }
        }
      }
    } else {
      const sig = computeFailureSignature({
        exit: res.exitCode,
        out_sha256: outSha256,
        reason_code: "command_failed",
      });
      // Lê o último recibo da task ANTES de gravar o atual.
      const prev = lastReceiptFor(ledger, task);

      if (shouldTrip(prev, sig)) {
        status = "blocked";
        reason_code = "breaker_same_failure";
        evidenceExit = res.exitCode;
        cliExit = BREAKER_EXIT;
        breaker = { tripped: true, failure_signature: sig };
        summary =
          `${task} blocked: disjuntor armado, mesma falha 2x seguidas (exit ${evidenceExit}); escalar ao dono`.slice(
            0,
            280,
          );
      } else {
        status = "fail";
        reason_code = "command_failed";
        evidenceExit = res.exitCode;
        cliExit = 1;
        breaker = { tripped: false, failure_signature: sig };
        summary = normalSummary();
      }
    }

    const tf = tokenFieldsFromOptions(opts);
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
        ...(holdoutEvidence !== null ? [holdoutEvidence] : []),
      ],
      tokens: tf.tokens,
      cost_usd: tf.cost_usd,
      cost_evidence: tf.cost_evidence,
      author: authorFromEnv(),
      verified_by: null,
      ...modeFields,
      ...(provedBaseRef !== null ? { base_ref: provedBaseRef } : {}),
      ...(status === "pass" && decision.effective === "completo"
        ? { flow: "awaiting_judge", next_action: "pinga judge" }
        : {}),
      ...(breaker !== undefined ? { breaker } : {}),
      ...(breaker?.tripped ? { next_action: BREAKER_NEXT_ACTION } : {}),
      summary,
      created_at: new Date().toISOString(),
    };

    ledger.append(receipt);
    if (process.env.PINGA_DISCORD_NOTIFY === "1") {
      notifyReceipt(receipt).catch(() => {});
    }
    console.log(JSON.stringify(receipt));
    return cliExit;
  } finally {
    ledger.close();
  }
}
