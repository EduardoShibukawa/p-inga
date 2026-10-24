import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalJson } from "./canonical";
import { attestFromEndpoint, attestFromTranscript, modelFamily } from "./family";
import { findRedBase } from "./guards";
import { defaultLedgerPath, openLedger, type Ledger } from "./ledger";
import { parsePlan } from "./plan";
import type { Attestation, Receipt, Status, ReasonCode } from "./receipt";
import { receiptKind } from "./receipt";
import { NOT_RUN_TOKENS, type TokenFields } from "./tokens";

export const JUDGE_EXIT = {
  pass: 0,
  judge_rejected: 1,
  same_family_judge: 7,
  infra: 8,
  model_unattested: 8,
} as const;

export const JUDGE_PROMPT_VERSION = 1;

export type JudgeOptions = {
  ledgerPath?: string;
  judgeModel?: string;
  endpoint?: string;
  base?: string;
  usageFile?: string;
};

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function assertDistinctFamily(
  executorFamily: string | null,
  judgeFamily: string,
): { ok: true } | { ok: false; reason_code: "same_family_judge" | "model_unattested" } {
  if (
    executorFamily === null ||
    executorFamily === "" ||
    executorFamily === "unknown"
  ) {
    return { ok: false, reason_code: "model_unattested" };
  }
  if (executorFamily === judgeFamily) {
    return { ok: false, reason_code: "same_family_judge" };
  }
  return { ok: true };
}

export function parseVerdict(
  content: string,
): { ok: true; verdict: "pass" | "fail"; findings: string[] } | { ok: false; error: string } {
  const cleaned = content.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: "veredito sem JSON" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return { ok: false, error: "veredito não é JSON válido" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "veredito não é um objeto" };
  }
  const p = parsed as Record<string, unknown>;
  if (p.verdict !== "pass" && p.verdict !== "fail") {
    return { ok: false, error: "verdict inválido" };
  }
  if (p.findings === undefined) {
    return { ok: true, verdict: p.verdict as "pass" | "fail", findings: [] };
  }
  if (
    !Array.isArray(p.findings) ||
    !p.findings.every((f): f is string => typeof f === "string")
  ) {
    return { ok: false, error: "findings deve ser um array de strings" };
  }
  return {
    ok: true,
    verdict: p.verdict as "pass" | "fail",
    findings: p.findings as string[],
  };
}

const SYSTEM_PROMPT = [
  `Você é o juiz de tarefas do p-inga (JUDGE_PROMPT_VERSION=${JUDGE_PROMPT_VERSION}).`,
  "Recebe o goal, o done_when e o diff da task e decide se a implementação cumpre o contrato.",
  "Responda APENAS com um JSON no formato {\"verdict\": \"pass\" | \"fail\", \"findings\": string[]}.",
  "verdict fail exige achados concretos em findings. Não use cercas nem prosa extra.",
].join(" ");

function judgeTokens(parsedBody: Record<string, unknown>, artifactSha: string): TokenFields {
  const usage =
    typeof parsedBody.usage === "object" && parsedBody.usage !== null
      ? (parsedBody.usage as Record<string, unknown>)
      : null;
  const inTok = usage?.prompt_tokens;
  const outTok = usage?.completion_tokens;
  if (
    typeof inTok === "number" &&
    Number.isInteger(inTok) &&
    inTok >= 0 &&
    typeof outTok === "number" &&
    Number.isInteger(outTok) &&
    outTok >= 0
  ) {
    return {
      tokens: { in: inTok, out: outTok, cache: null, source: "host-structured" },
      cost_usd: null,
      cost_evidence: `judge-response:${artifactSha}`,
    };
  }
  return NOT_RUN_TOKENS;
}

function judgeReceipt(
  args: {
    task: string;
    status: Status;
    reason_code: ReasonCode | null;
    attempts: number;
    evidence: Receipt["evidence"];
    tokenFields: TokenFields;
    author: { model: string | null; family: string | null };
    verified_by: { model: string | null; family: string | null } | null;
    summary: string;
    model_attested?: Attestation;
  },
): Receipt {
  return {
    v: 1,
    type: "task.receipt",
    id: randomUUID(),
    task: args.task,
    status: args.status,
    reason_code: args.reason_code,
    attempts: args.attempts,
    evidence: args.evidence,
    tokens: args.tokenFields.tokens,
    cost_usd: args.tokenFields.cost_usd,
    cost_evidence: args.tokenFields.cost_evidence,
    author: args.author,
    verified_by: args.verified_by,
    ...(args.model_attested !== undefined ? { model_attested: args.model_attested } : {}),
    summary: args.summary,
    created_at: new Date().toISOString(),
    flow: "judge",
  };
}

function emit(ledger: Ledger, receipt: Receipt): void {
  ledger.append(receipt);
  console.log(JSON.stringify(receipt));
}

export async function judgePlan(
  planPath: string,
  opts?: JudgeOptions,
): Promise<number> {
  const resolvedPlan = resolve(planPath);
  const dir = dirname(resolvedPlan);
  const task = basename(dir);

  const gitRoot = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const repoRoot =
    gitRoot.exitCode === 0 ? gitRoot.stdout.toString().trim() : dir;

  // 1. Plano inválido → exit 3, sem recibo.
  let plan;
  try {
    plan = parsePlan(readFileSync(resolvedPlan, "utf8"));
  } catch (err) {
    console.error(String((err as Error).message));
    return 3;
  }
  if (!plan.ok) {
    console.error(`plano inválido: ${plan.errors.join("; ")}`);
    return 3;
  }

  const ledger = openLedger(opts?.ledgerPath ?? defaultLedgerPath());
  try {
    const all = ledger
      .all()
      .filter((row) => row.task === task)
      .map((row) => JSON.parse(row.body) as Receipt);
    const verifyReceipts = all.filter((r) => receiptKind(r) === "verify");
    const judgeCount = all.filter((r) => receiptKind(r) === "judge").length;
    const last = verifyReceipts[verifyReceipts.length - 1] ?? null;

    // 2. Nada a julgar → exit 1, sem recibo.
    if (last === null || last.status !== "pass") {
      console.error(`nada a julgar: último verify de ${task} não é pass`);
      return 1;
    }

    // 3. Base do diff: --base validada como na T04 (exit 2), senão findRedBase.
    let resolvedBase: string | undefined;
    if (opts?.base !== undefined) {
      const check = Bun.spawnSync(
        ["git", "rev-parse", "--verify", "--quiet", `${opts.base}^{commit}`],
        { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
      );
      if (check.exitCode !== 0) {
        console.error(`base inválida: ${opts.base}`);
        return 2;
      }
      resolvedBase = opts.base;
    }
    const baseSha = resolvedBase ?? findRedBase(repoRoot, task);
    if (baseSha === null) {
      console.error(`sem base para o diff de ${task}`);
      return 2;
    }

    const attempts = last.attempts;
    const author = { model: last.author.model, family: last.author.family };
    const tokenFields = NOT_RUN_TOKENS;

    // 4. Executor: transcript (--usage-file / PINGA_USAGE_FILE) vence a config.
    const claimedExec = last.author.model;
    let transcriptServed: string | null = null;
    const usagePath = opts?.usageFile ?? process.env.PINGA_USAGE_FILE;
    if (usagePath !== undefined && usagePath !== "") {
      try {
        const tRes = attestFromTranscript(readFileSync(usagePath, "utf8"), claimedExec);
        if (tRes.ok) transcriptServed = tRes.attested.served;
      } catch {
        // transcript ilegível: cai no alegado
      }
    }
    const execModel = transcriptServed ?? last.author.model;
    const execFamily =
      transcriptServed !== null
        ? modelFamily(transcriptServed)
        : execModel
          ? modelFamily(execModel)
          : (last.author.family ?? null);
    author.model = execModel;
    author.family = execFamily;

    // 5. Executor sem família: fail-closed ANTES de qualquer rede (I10).
    if (!execFamily || execFamily === "unknown") {
      emit(
        ledger,
        judgeReceipt({
          task,
          status: "blocked",
          reason_code: "model_unattested",
          attempts,
          evidence: [],
          tokenFields,
          author: { model: execModel, family: execFamily },
          verified_by: null,
          summary: `${task} blocked: família do executor desconhecida`,
        }),
      );
      return JUDGE_EXIT.model_unattested;
    }

    // 6. Juiz: atestado obrigatório pelo endpoint (I11).
    const claimedJudge =
      opts?.judgeModel ?? process.env.PINGA_JUDGE_MODEL ?? null;
    const endpoint =
      opts?.endpoint ?? process.env.PINGA_JUDGE_ENDPOINT ?? "http://127.0.0.1:8089";

    const attestRes = await attestFromEndpoint(endpoint, claimedJudge);
    if (!attestRes.ok) {
      if (attestRes.reason_code === "model_unattested") {
        emit(
          ledger,
          judgeReceipt({
            task,
            status: "blocked",
            reason_code: "model_unattested",
            attempts,
            evidence: [],
            tokenFields,
            author,
            verified_by: null,
            summary: `${task} blocked: modelo do juiz não atestado (${attestRes.error})`.slice(0, 280),
          }),
        );
        return JUDGE_EXIT.model_unattested;
      }
      emit(
        ledger,
        judgeReceipt({
          task,
          status: "not run",
          reason_code: "infra",
          attempts,
          evidence: [],
          tokenFields,
          author,
          verified_by: null,
          summary: `${task} not run: juiz indisponível (${attestRes.error})`.slice(0, 280),
        }),
      );
      return JUDGE_EXIT.infra;
    }

    const attested = attestRes.attested;
    const judgeFam = modelFamily(attested.served);

    // 6b. Mesma família → blocked, sem chamar o chat (I10).
    const dist = assertDistinctFamily(execFamily, judgeFam);
    if (!dist.ok) {
      emit(
        ledger,
        judgeReceipt({
          task,
          status: "blocked",
          reason_code: "same_family_judge",
          attempts,
          evidence: [],
          tokenFields,
          author,
          verified_by: null,
          summary: `${task} blocked: juiz ${attested.served} é da mesma família do executor (${judgeFam})`.slice(0, 280),
          model_attested: attested,
        }),
      );
      return JUDGE_EXIT.same_family_judge;
    }

    // 7. Diff da base (tracked, base → HEAD), cortado por bytes UTF-8.
    const diffRes = Bun.spawnSync(["git", "diff", "--no-renames", baseSha], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const diffBuf =
      diffRes.exitCode === 0
        ? Buffer.from(diffRes.stdout as Uint8Array)
        : Buffer.alloc(0);
    const maxDiffBytes = Number(
      process.env.PINGA_JUDGE_MAX_DIFF_BYTES ?? 48000,
    );
    const diff =
      diffBuf.byteLength > maxDiffBytes
        ? diffBuf.subarray(0, maxDiffBytes).toString("utf8") +
          `\n[diff cortado em ${maxDiffBytes} bytes]`
        : diffBuf.toString("utf8");

    const userContent =
      `goal: ${plan.plan.goal}\n` +
      `done_when: ${plan.plan.done_when}\n\n` +
      `git diff ${baseSha} (base RED → árvore atual):\n${diff}`;
    const request = {
      model: attested.served,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    };

    const timeoutMs = Number(process.env.PINGA_JUDGE_TIMEOUT_MS ?? 120000);
    const t0 = Date.now();
    let chatRes: Response;
    try {
      chatRes = await fetch(`${endpoint.replace(/\/+$/, "")}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      emit(
        ledger,
        judgeReceipt({
          task,
          status: "not run",
          reason_code: "infra",
          attempts,
          evidence: [],
          tokenFields,
          author,
          verified_by: null,
          summary: `${task} not run: juiz indisponível (${(err as Error).message})`.slice(0, 280),
          model_attested: attested,
        }),
      );
      return JUDGE_EXIT.infra;
    }
    const duration_ms = Math.max(0, Date.now() - t0);
    if (!chatRes.ok) {
      emit(
        ledger,
        judgeReceipt({
          task,
          status: "not run",
          reason_code: "infra",
          attempts,
          evidence: [],
          tokenFields,
          author,
          verified_by: null,
          summary: `${task} not run: juiz indisponível (HTTP ${chatRes.status})`.slice(0, 280),
          model_attested: attested,
        }),
      );
      return JUDGE_EXIT.infra;
    }

    // Artefato: runs/<task>/judge-<n>.json (n = 1 + recibos judge da task).
    const judgeN = judgeCount + 1;
    const artifactRelPath = `runs/${task}/judge-${judgeN}.json`;
    const artifactPath = join(repoRoot, "runs", task, `judge-${judgeN}.json`);
    let rawContent: unknown;
    let parsedBody: Record<string, unknown> = {};
    try {
      parsedBody = (await chatRes.json()) as Record<string, unknown>;
    } catch {
      parsedBody = {};
    }
    const choices =
      Array.isArray(parsedBody.choices) ? parsedBody.choices : null;
    const firstChoice =
      choices !== null && typeof choices[0] === "object" && choices[0] !== null
        ? (choices[0] as Record<string, unknown>)
        : null;
    const message =
      firstChoice !== null && typeof firstChoice.message === "object" && firstChoice.message !== null
        ? (firstChoice.message as Record<string, unknown>)
        : null;
    rawContent = message?.content;
    const artifactBytes = Buffer.from(
      canonicalJson({ request, response_content: rawContent }),
      "utf8",
    );
    mkdirSync(join(repoRoot, "runs", task), { recursive: true });
    writeFileSync(artifactPath, artifactBytes);
    const artifactSha = sha256hex(artifactBytes);

    // 8. Veredito.
    const verdictRes = parseVerdict(
      typeof rawContent === "string" ? rawContent : "",
    );
    if (!verdictRes.ok) {
      emit(
        ledger,
        judgeReceipt({
          task,
          status: "not run",
          reason_code: "infra",
          attempts,
          evidence: [
            {
              kind: "command",
              cmd_sha256: sha256hex(canonicalJson(request)),
              exit: null,
              duration_ms,
              artifact_ref: { path: artifactRelPath, sha256: artifactSha },
            },
          ],
          tokenFields,
          author,
          verified_by: null,
          summary: `${task} not run: juiz indisponível (${verdictRes.error})`.slice(0, 280),
          model_attested: attested,
        }),
      );
      return JUDGE_EXIT.infra;
    }

    const verified_by = { model: attested.served, family: judgeFam };
    const evidence: Receipt["evidence"] = [
      {
        kind: "command",
        cmd_sha256: sha256hex(canonicalJson(request)),
        exit: verdictRes.verdict === "pass" ? 0 : 1,
        duration_ms,
        artifact_ref: { path: artifactRelPath, sha256: artifactSha },
      },
    ];
    const tf = judgeTokens(parsedBody, artifactSha);

    if (verdictRes.verdict === "pass") {
      emit(
        ledger,
        judgeReceipt({
          task,
          status: "pass",
          reason_code: null,
          attempts,
          evidence,
          tokenFields: tf,
          author,
          verified_by,
          summary: `${task} pass: juiz ${attested.served} (${judgeFam}) aprovou`.slice(0, 280),
          model_attested: attested,
        }),
      );
      return JUDGE_EXIT.pass;
    }

    emit(
      ledger,
      judgeReceipt({
        task,
        status: "fail",
        reason_code: "judge_rejected",
        attempts,
        evidence,
        tokenFields: tf,
        author,
        verified_by,
        summary: `${task} fail: juiz ${attested.served} (${judgeFam}) reprovou (${verdictRes.findings.length} achados)`.slice(0, 280),
        model_attested: attested,
      }),
    );
    return JUDGE_EXIT.judge_rejected;
  } finally {
    ledger.close();
  }
}
