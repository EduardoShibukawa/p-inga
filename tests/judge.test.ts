import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lastReceiptFor } from "../src/breaker";
import { validateEval } from "../src/eval";
import {
  FAMILY_ALIASES,
  attestFromEndpoint,
  attestFromTranscript,
  modelFamily,
  normalizeServedId,
  servedFromModels,
} from "../src/family";
import { JUDGE_EXIT, JUDGE_PROMPT_VERSION, assertDistinctFamily, parseVerdict } from "../src/judge";
import { openLedger } from "../src/ledger";
import { type Receipt, receiptKind, validateReceipt } from "../src/receipt";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

function sha256hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function git(cwd: string, args: string[]) {
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.toString()}`);
  }
  return res.stdout.toString().trim();
}

function makeReceipt(overrides: Partial<Receipt> & Record<string, unknown> = {}): Receipt {
  return {
    v: 1,
    type: "task.receipt",
    id: `rcpt-${Math.random()}`,
    task: "TX",
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [
      {
        kind: "command",
        cmd_sha256: "a".repeat(64),
        exit: 0,
        duration_ms: 10,
        artifact_ref: {
          path: "runs/TX/1/out.txt",
          sha256: "b".repeat(64),
        },
      },
    ],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: "claude-opus-5-5", family: "claude" },
    verified_by: null,
    summary: "TX pass: done_when exit 0 em 0s",
    created_at: "2026-10-24T21:30:00.000Z",
    ...overrides,
  } as Receipt;
}

function makeJudgeFixture(task = "TX") {
  const repoDir = mkdtempSync(join(tmpdir(), "pinga-judge-repo-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-judge-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");

  git(repoDir, ["init", "-q", "-b", "main"]);
  git(repoDir, ["config", "user.email", "test@example.com"]);
  git(repoDir, ["config", "user.name", "Test User"]);

  mkdirSync(join(repoDir, "tasks", task), { recursive: true });
  mkdirSync(join(repoDir, "src"), { recursive: true });
  mkdirSync(join(repoDir, "tests"), { recursive: true });

  const planPath = join(repoDir, "tasks", task, "PLAN.md");
  const planContent = [
    "---",
    "mode: padrao",
    'goal: "meta do TX"',
    'done_when: "true"',
    'touch: ["src/a.ts"]',
    'tests_frozen: ["tests/a.test.ts"]',
    "budget: { tokens: 100000, minutes: 5 }",
    "---",
    "## Passos",
    "- [ ] step",
  ].join("\n");

  writeFileSync(planPath, `${planContent}\n`);
  writeFileSync(join(repoDir, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(repoDir, "tests/a.test.ts"), "// init\n");
  writeFileSync(join(repoDir, ".gitignore"), "runs/\n.pinga/\n*.db\n");

  git(repoDir, ["add", `tasks/${task}/PLAN.md`, "src/a.ts", "tests/a.test.ts", ".gitignore"]);
  git(repoDir, ["commit", "-m", "chore: init"]);

  writeFileSync(join(repoDir, "tests/a.test.ts"), "// RED\n");
  git(repoDir, ["add", "tests/a.test.ts"]);
  git(repoDir, ["commit", "-m", `test(${task}): RED`]);

  writeFileSync(join(repoDir, "src/a.ts"), "export const a = 2;\n");
  git(repoDir, ["add", "src/a.ts"]);
  git(repoDir, ["commit", "-m", `feat(${task}): green`]);

  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (
      !k.startsWith("PINGA_JUDGE_") &&
      k !== "PINGA_USAGE_FILE" &&
      k !== "PINGA_PLANNER_MODEL" &&
      k !== "PINGA_PLANNER_FAMILY" &&
      v !== undefined
    ) {
      cleanEnv[k] = v;
    }
  }

  return {
    repoDir,
    planPath,
    ledgerPath,
    cleanEnv,
    cleanup: () => {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

async function runCliAsync(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", BIN, ...args], {
    cwd: ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("T08 — Distinct Family Judge (I10 / I11)", () => {
  test("1. modelFamily normalizes prefixes, providers, tags, .gguf and aliases accurately", () => {
    expect(Array.isArray(FAMILY_ALIASES)).toBe(true);
    expect(JUDGE_EXIT).toEqual({
      pass: 0,
      judge_rejected: 1,
      same_family_judge: 7,
      infra: 8,
      model_unattested: 8,
    });
    expect(JUDGE_PROMPT_VERSION).toBe(1);

    for (const m of [
      "claude-opus-5-5",
      "Claude-Sonnet-5-5",
      "us.anthropic.claude-haiku-5-5-v1:0",
      "anthropic/claude-fable-5-1",
      "opus",
    ]) {
      expect(modelFamily(m)).toBe("claude");
    }

    for (const m of ["gemini-4-argon", "models/gemini-3.8-flash", "gemma-3-27b"]) {
      expect(modelFamily(m)).toBe("gemini");
    }

    for (const m of ["gpt-6-luna", "openai/gpt-5", "o3-mini", "codex-2"]) {
      expect(modelFamily(m)).toBe("gpt");
    }

    for (const m of [
      "qwen3.5-4b",
      "Qwen3.5-4B-Q4_K_M.gguf",
      "openrouter/qwen/qwen3.8-flash:free",
      "qwq-32b",
    ]) {
      expect(modelFamily(m)).toBe("qwen");
    }

    expect(modelFamily("deepseek-v4-pro")).toBe("deepseek");
    expect(modelFamily("glm-5.3-flash-free")).toBe("glm");
    expect(modelFamily("minimax-m3.1-flash-free")).toBe("minimax");
    expect(modelFamily("kimi-k3")).toBe("kimi");
    expect(modelFamily("moonshot-v1")).toBe("kimi");
    expect(modelFamily("mixtral-8x7b")).toBe("mistral");

    expect(modelFamily("ornith-9b-local")).toBe("ornith");
    expect(modelFamily("laguna-s-2.1:free")).toBe("laguna");
    expect(modelFamily("omni-x")).toBe("omni");

    expect(modelFamily("")).toBe("unknown");
    expect(modelFamily("   ")).toBe("unknown");
    expect(modelFamily(null)).toBe("unknown");
    expect(modelFamily(undefined)).toBe("unknown");
  });

  test("2. normalizeServedId strips paths, .gguf and quantization suffixes", () => {
    expect(normalizeServedId("/models/Qwen3.5-4B-Q4_K_M.gguf")).toBe("qwen3.5-4b");
    expect(normalizeServedId("qwen3.5-4b-F16")).toBe("qwen3.5-4b");
    expect(normalizeServedId("x-IQ4_XS")).toBe("x");
  });

  test("3. servedFromModels handles OpenAI/llama-server payloads, false aliases and ambiguity", () => {
    expect(servedFromModels({ data: [{ id: "qwen3.5-4b" }] }, "ornith-9b-local")).toEqual({
      ok: true,
      served: "qwen3.5-4b",
    });

    expect(servedFromModels({ data: [{ id: "/m/Qwen3.5-4B-Q4_K_M.gguf" }] }, null)).toEqual({
      ok: true,
      served: "qwen3.5-4b",
    });

    expect(
      servedFromModels({ data: [{ id: "a" }, { id: "qwen3.5-4b" }] }, "qwen3.5-4b"),
    ).toEqual({
      ok: true,
      served: "qwen3.5-4b",
    });

    const amb1 = servedFromModels({ data: [{ id: "a" }, { id: "b" }] }, "c");
    expect(amb1.ok).toBe(false);
    if (!amb1.ok) {
      expect(amb1.reason_code).toBe("model_unattested");
      expect(amb1.error).toContain("ambíguo");
    }

    const amb2 = servedFromModels({ data: [{ id: "a" }, { id: "b" }] }, null);
    expect(amb2.ok).toBe(false);
    if (!amb2.ok) {
      expect(amb2.reason_code).toBe("model_unattested");
      expect(amb2.error).toContain("ambíguo");
    }

    expect(servedFromModels({ models: [{ model: "/m/Qwen3.5-4B.gguf" }] }, null)).toEqual({
      ok: true,
      served: "qwen3.5-4b",
    });

    const empty = servedFromModels({ data: [] }, null);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason_code).toBe("model_unattested");

    const bad1 = servedFromModels("x", null);
    expect(bad1.ok).toBe(false);
    if (!bad1.ok) expect(bad1.reason_code).toBe("infra");

    const bad2 = servedFromModels({}, null);
    expect(bad2.ok).toBe(false);
    if (!bad2.ok) expect(bad2.reason_code).toBe("infra");
  });

  test("4. attestFromTranscript extracts dominant model, ignores <synthetic>/invalid JSON, rejects multi-family", () => {
    const transcript1 = [
      "{oops",
      JSON.stringify({ message: { model: "<synthetic>" } }),
      JSON.stringify({ message: { model: "claude-opus-5-5" } }),
      JSON.stringify({ message: { model: "claude-opus-5-5" } }),
      JSON.stringify({ message: { model: "claude-opus-5-5" } }),
      JSON.stringify({ message: { model: "claude-haiku-5-5" } }),
    ].join("\n");
    expect(attestFromTranscript(transcript1, "claimed-x")).toEqual({
      ok: true,
      attested: {
        claimed: "claimed-x",
        served: "claude-opus-5-5",
        via: "transcript",
      },
    });

    const tie = [
      JSON.stringify({ model: "x-b-model" }),
      JSON.stringify({ model: "x-a-model" }),
    ].join("\n");
    expect(attestFromTranscript(tie, null)).toEqual({
      ok: true,
      attested: {
        claimed: null,
        served: "x-a-model",
        via: "transcript",
      },
    });

    const multiFam = [
      JSON.stringify({ model: "claude-opus-5-5" }),
      JSON.stringify({ model: "qwen3.8-flash" }),
    ].join("\n");
    const rMulti = attestFromTranscript(multiFam, null);
    expect(rMulti.ok).toBe(false);
    if (!rMulti.ok) {
      expect(rMulti.reason_code).toBe("model_unattested");
      expect(rMulti.error).toContain("várias famílias");
    }

    const noModel = JSON.stringify({ type: "user", text: "hi" });
    const rNone = attestFromTranscript(noModel, null);
    expect(rNone.ok).toBe(false);
    if (!rNone.ok) {
      expect(rNone.reason_code).toBe("model_unattested");
      expect(rNone.error).toContain("transcript sem modelo");
    }
  });

  test("5. assertDistinctFamily enforces distinct family and fail-closed on unknown executor", () => {
    expect(assertDistinctFamily("claude", "qwen")).toEqual({ ok: true });
    expect(assertDistinctFamily("claude", "claude")).toEqual({
      ok: false,
      reason_code: "same_family_judge",
    });
    expect(assertDistinctFamily(null, "qwen")).toEqual({
      ok: false,
      reason_code: "model_unattested",
    });
    expect(assertDistinctFamily("", "qwen")).toEqual({
      ok: false,
      reason_code: "model_unattested",
    });
    expect(assertDistinctFamily("unknown", "qwen")).toEqual({
      ok: false,
      reason_code: "model_unattested",
    });
  });

  test("6. parseVerdict parses JSON verdict with or without markdown fences", () => {
    expect(parseVerdict('{"verdict":"pass"}')).toEqual({
      ok: true,
      verdict: "pass",
      findings: [],
    });

    expect(
      parseVerdict('Aqui está o parecer:\n```json\n{"verdict":"pass","findings":[]}\n```\nFim.'),
    ).toEqual({
      ok: true,
      verdict: "pass",
      findings: [],
    });

    expect(parseVerdict('{"verdict":"fail","findings":["a","b"]}')).toEqual({
      ok: true,
      verdict: "fail",
      findings: ["a", "b"],
    });

    expect(parseVerdict('{"verdict":"PASS"}').ok).toBe(false);
    expect(parseVerdict('{"verdict":"ok"}').ok).toBe(false);
    expect(parseVerdict("não sei").ok).toBe(false);
    expect(parseVerdict('{"verdict":"pass","findings":[1]}').ok).toBe(false);
  });

  test("7, 8 & 9. validateReceipt with model_attested, receiptKind, and lastReceiptFor filtering", () => {
    expect(
      validateReceipt(
        makeReceipt({
          model_attested: {
            claimed: "ornith-9b-local",
            served: "qwen3.5-4b",
            via: "/v1/models",
          },
        }),
      ).ok,
    ).toBe(true);

    expect(
      validateReceipt(
        makeReceipt({
          model_attested: {
            claimed: null,
            served: "qwen3.5-4b",
            via: "transcript",
          },
        }),
      ).ok,
    ).toBe(true);

    expect(
      validateReceipt(
        makeReceipt({
          model_attested: { claimed: null, served: "qwen3.5-4b", via: "config" },
        }),
      ).ok,
    ).toBe(false);

    expect(
      validateReceipt(
        makeReceipt({
          model_attested: { claimed: null, served: "", via: "/v1/models" },
        }),
      ).ok,
    ).toBe(false);

    const extraRes = validateReceipt(
      makeReceipt({
        model_attested: { claimed: null, served: "qwen3.5-4b", via: "/v1/models", extra: 1 },
      }),
    );
    expect(extraRes.ok).toBe(false);
    if (!extraRes.ok) {
      expect(extraRes.errors.some((e) => e.includes("extra"))).toBe(true);
    }

    expect(receiptKind({ flow: "judge" })).toBe("judge");
    expect(receiptKind({})).toBe("verify");
    expect(receiptKind({ flow: "awaiting_judge" })).toBe("verify");

    const dir = mkdtempSync(join(tmpdir(), "pinga-judge-kind-"));
    try {
      const ledger = openLedger(join(dir, "l.db"));
      ledger.append(makeReceipt({ id: "v-fail", status: "fail", reason_code: "command_failed" }));
      ledger.append(makeReceipt({ id: "j-pass", status: "pass", reason_code: null, flow: "judge" }));
      expect(lastReceiptFor(ledger, "TX")?.id).toBe("v-fail");
      ledger.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("10..24. CLI pinga judge with mock Bun.serve endpoint, attestation, anti-self-grading, eval integration", async () => {
    let modelsBody: unknown = { data: [{ id: "qwen3.5-4b" }] };
    let modelsStatus = 200;
    let chatBody: unknown = {
      choices: [{ message: { content: '{"verdict":"pass","findings":[]}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10 },
    };
    let chatStatus = 200;
    let modelsCount = 0;
    let chatCount = 0;
    let lastChatReq: Record<string, unknown> | null = null;

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/models") {
          modelsCount++;
          return new Response(JSON.stringify(modelsBody), {
            status: modelsStatus,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.pathname === "/v1/chat/completions") {
          chatCount++;
          lastChatReq = (await req.json()) as Record<string, unknown>;
          return new Response(JSON.stringify(chatBody), {
            status: chatStatus,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const endpoint = `http://127.0.0.1:${server.port}`;

    // Also test attestFromEndpoint directly
    const directAttest = await attestFromEndpoint(endpoint, "ornith-9b-local");
    expect(directAttest).toEqual({
      ok: true,
      attested: {
        claimed: "ornith-9b-local",
        served: "qwen3.5-4b",
        via: "/v1/models",
      },
    });

    const { repoDir, planPath, ledgerPath, cleanEnv, cleanup } = makeJudgeFixture("TX");
    try {
      // Case 19b: Empty ledger -> nada a julgar
      const rEmpty = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", endpoint],
        cleanEnv,
      );
      expect(rEmpty.exitCode).toBe(1);
      expect(rEmpty.stderr).toContain("nada a julgar");

      // Case 19a: Last verify is fail -> nada a julgar
      let ledger = openLedger(ledgerPath);
      ledger.append(makeReceipt({ status: "fail", reason_code: "command_failed", attempts: 1 }));
      ledger.close();

      const rFailLast = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", endpoint],
        cleanEnv,
      );
      expect(rFailLast.exitCode).toBe(1);
      expect(rFailLast.stderr).toContain("nada a julgar");

      // Append verify pass (attempts: 1, author: claude-opus-5-5 / claude)
      ledger = openLedger(ledgerPath);
      ledger.append(
        makeReceipt({
          id: "verify-pass-1",
          status: "pass",
          reason_code: null,
          attempts: 1,
          author: { model: "claude-opus-5-5", family: "claude" },
        }),
      );
      ledger.close();

      // Case 10: Pass with false alias ornith-9b-local served by qwen3.5-4b
      modelsCount = 0;
      chatCount = 0;
      const r10 = await runCliAsync(
        [
          "judge",
          planPath,
          "--ledger",
          ledgerPath,
          "--judge-model",
          "ornith-9b-local",
          "--endpoint",
          endpoint,
        ],
        cleanEnv,
      );
      expect(r10.exitCode).toBe(0);
      const rcpt10 = JSON.parse(r10.stdout.trim());
      expect(rcpt10.flow).toBe("judge");
      expect(rcpt10.status).toBe("pass");
      expect(rcpt10.reason_code).toBeNull();
      expect(rcpt10.attempts).toBe(1);
      expect(rcpt10.verified_by).toEqual({ model: "qwen3.5-4b", family: "qwen" });
      expect(rcpt10.author.family).toBe("claude");
      expect(rcpt10.model_attested).toEqual({
        claimed: "ornith-9b-local",
        served: "qwen3.5-4b",
        via: "/v1/models",
      });
      expect(lastChatReq?.model).toBe("qwen3.5-4b");
      expect(lastChatReq?.temperature).toBe(0);
      const messages = lastChatReq?.messages as Array<{ role: string; content: string }>;
      const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
      expect(userMsg).toContain("meta do TX");
      expect(userMsg).toContain("src/a.ts");
      expect(rcpt10.tokens).toEqual({ in: 100, out: 10, cache: null, source: "host-structured" });
      const judgeArtifact1 = join(repoDir, "runs/TX/judge-1.json");
      expect(existsSync(judgeArtifact1)).toBe(true);
      expect(rcpt10.evidence[0].artifact_ref.sha256).toBe(sha256hex(readFileSync(judgeArtifact1)));
      expect(validateReceipt(rcpt10).ok).toBe(true);

      // Case 22: eval after Case 10
      const rEval = await runCliAsync(["eval", planPath, "--ledger", ledgerPath], cleanEnv);
      expect(rEval.exitCode).toBe(0);
      const evalText = readFileSync(join(repoDir, "tasks/TX/EVAL.md"), "utf8");
      expect(evalText).toContain("status pass · tentativas 2"); // 2 verify receipts in ledger
      expect(evalText).toContain("tokens in=100 out=10 cache=null usd=null");
      expect(evalText).toContain("juiz qwen3.5-4b (qwen) aprovou");
      expect(validateEval(evalText, "TX").ok).toBe(true);

      // Case 20: Determinism: 2nd judge run in same state
      const r20 = await runCliAsync(
        [
          "judge",
          planPath,
          "--ledger",
          ledgerPath,
          "--judge-model",
          "ornith-9b-local",
          "--endpoint",
          endpoint,
        ],
        cleanEnv,
      );
      expect(r20.exitCode).toBe(0);
      const rcpt20 = JSON.parse(r20.stdout.trim());
      expect(existsSync(join(repoDir, "runs/TX/judge-2.json"))).toBe(true);
      expect(rcpt20.evidence[0].cmd_sha256).toBe(rcpt10.evidence[0].cmd_sha256);
      ledger = openLedger(ledgerPath);
      expect(lastReceiptFor(ledger, "TX")?.id).toBe("verify-pass-1");
      ledger.close();

      // Case 21: Diff truncated with PINGA_JUDGE_MAX_DIFF_BYTES=10
      const r21 = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", endpoint],
        { ...cleanEnv, PINGA_JUDGE_MAX_DIFF_BYTES: "10" },
      );
      expect(r21.exitCode).toBe(0);
      const msgs21 = (lastChatReq?.messages as Array<{ role: string; content: string }>) ?? [];
      expect(msgs21.find((m) => m.role === "user")?.content).toContain("[diff cortado em 10 bytes]");

      // Case 11: Verdict fail with 2 findings -> exit 1, fail/judge_rejected
      chatBody = {
        choices: [{ message: { content: '{"verdict":"fail","findings":["bug 1","bug 2"]}' } }],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      };
      const r11 = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", endpoint],
        cleanEnv,
      );
      expect(r11.exitCode).toBe(1);
      const rcpt11 = JSON.parse(r11.stdout.trim());
      expect(rcpt11.status).toBe("fail");
      expect(rcpt11.reason_code).toBe("judge_rejected");
      expect(rcpt11.verified_by).toEqual({ model: "qwen3.5-4b", family: "qwen" });
      expect(rcpt11.summary).toContain("reprovou (2 achados)");
      expect(validateReceipt(rcpt11).ok).toBe(true);

      // Reset chatBody to pass
      chatBody = {
        choices: [{ message: { content: '{"verdict":"pass","findings":[]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };

      // Case 12: Same family (claude-haiku-5-5 judging claude-opus-5-5) -> exit 7, 0 chat requests
      modelsBody = { data: [{ id: "claude-haiku-5-5" }] };
      chatCount = 0;
      const r12 = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", endpoint],
        cleanEnv,
      );
      expect(r12.exitCode).toBe(7);
      expect(chatCount).toBe(0);
      const rcpt12 = JSON.parse(r12.stdout.trim());
      expect(rcpt12.status).toBe("blocked");
      expect(rcpt12.reason_code).toBe("same_family_judge");
      expect(rcpt12.verified_by).toBeNull();
      expect(rcpt12.model_attested.served).toBe("claude-haiku-5-5");
      expect(validateReceipt(rcpt12).ok).toBe(true);

      // Case 13: Alias fraud caught by family (executor qwen3.8-flash, judge claims ornith-9b-local but serves Qwen3.5-4B)
      ledger = openLedger(ledgerPath);
      ledger.append(
        makeReceipt({
          status: "pass",
          reason_code: null,
          attempts: 2,
          author: { model: "qwen3.8-flash", family: "qwen" },
        }),
      );
      ledger.close();
      modelsBody = { data: [{ id: "/m/Qwen3.5-4B-Q4_K_M.gguf" }] };
      chatCount = 0;
      const r13 = await runCliAsync(
        [
          "judge",
          planPath,
          "--ledger",
          ledgerPath,
          "--judge-model",
          "ornith-9b-local",
          "--endpoint",
          endpoint,
        ],
        cleanEnv,
      );
      expect(r13.exitCode).toBe(7);
      expect(chatCount).toBe(0);

      // Case 14: Unknown executor family -> exit 8, blocked/model_unattested, 0 requests on any route
      ledger = openLedger(ledgerPath);
      ledger.append(
        makeReceipt({
          status: "pass",
          reason_code: null,
          attempts: 3,
          author: { model: null, family: null },
        }),
      );
      ledger.close();
      modelsCount = 0;
      chatCount = 0;
      const r14 = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", endpoint],
        cleanEnv,
      );
      expect(r14.exitCode).toBe(8);
      expect(modelsCount).toBe(0);
      expect(chatCount).toBe(0);
      const rcpt14 = JSON.parse(r14.stdout.trim());
      expect(rcpt14.status).toBe("blocked");
      expect(rcpt14.reason_code).toBe("model_unattested");
      expect(rcpt14.summary).toContain("família do executor desconhecida");
      expect(validateReceipt(rcpt14).ok).toBe(true);

      // Case 15: Transcript overrides claimed author
      ledger = openLedger(ledgerPath);
      ledger.append(
        makeReceipt({
          status: "pass",
          reason_code: null,
          attempts: 4,
          author: { model: "gemini-3.8-flash", family: "gemini" },
        }),
      );
      ledger.close();
      const usageFile = join(repoDir, "transcript.jsonl");
      writeFileSync(
        usageFile,
        `${JSON.stringify({ message: { model: "claude-opus-5-5" } })}\n`,
      );

      modelsBody = { data: [{ id: "claude-haiku-5-5" }] };
      const r15a = await runCliAsync(
        [
          "judge",
          planPath,
          "--ledger",
          ledgerPath,
          "--endpoint",
          endpoint,
          "--usage-file",
          usageFile,
        ],
        cleanEnv,
      );
      expect(r15a.exitCode).toBe(7);

      modelsBody = { data: [{ id: "qwen3.5-4b" }] };
      const r15b = await runCliAsync(
        [
          "judge",
          planPath,
          "--ledger",
          ledgerPath,
          "--endpoint",
          endpoint,
          "--usage-file",
          usageFile,
        ],
        cleanEnv,
      );
      expect(r15b.exitCode).toBe(0);
      const rcpt15b = JSON.parse(r15b.stdout.trim());
      expect(rcpt15b.author).toEqual({ model: "claude-opus-5-5", family: "claude" });

      // Case 16: Endpoint down -> exit 8, not run/infra
      const r16 = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", "http://127.0.0.1:1"],
        cleanEnv,
      );
      expect(r16.exitCode).toBe(8);
      const rcpt16 = JSON.parse(r16.stdout.trim());
      expect(rcpt16.status).toBe("not run");
      expect(rcpt16.reason_code).toBe("infra");
      expect(rcpt16.summary).toContain("indisponível");
      expect(rcpt16.model_attested).toBeUndefined();
      expect(validateReceipt(rcpt16).ok).toBe(true);

      // Case 17: Ambiguous /v1/models without --judge-model -> exit 8, blocked/model_unattested
      modelsBody = { data: [{ id: "a" }, { id: "b" }] };
      chatCount = 0;
      const r17 = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", endpoint],
        cleanEnv,
      );
      expect(r17.exitCode).toBe(8);
      expect(chatCount).toBe(0);
      const rcpt17 = JSON.parse(r17.stdout.trim());
      expect(rcpt17.status).toBe("blocked");
      expect(rcpt17.reason_code).toBe("model_unattested");

      // Case 18: Chat HTTP 500 and chat non-verdict content
      modelsBody = { data: [{ id: "qwen3.5-4b" }] };
      chatStatus = 500;
      const r18a = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", endpoint],
        cleanEnv,
      );
      expect(r18a.exitCode).toBe(8);
      expect(JSON.parse(r18a.stdout.trim()).reason_code).toBe("infra");

      chatStatus = 200;
      chatBody = { choices: [{ message: { content: "não sei" } }] };
      const r18b = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--endpoint", endpoint],
        cleanEnv,
      );
      expect(r18b.exitCode).toBe(8);
      expect(JSON.parse(r18b.stdout.trim()).reason_code).toBe("infra");

      // Case 23: CLI invalid flags
      expect((await runCliAsync(["judge"], cleanEnv)).exitCode).toBe(2);
      expect((await runCliAsync(["judge", planPath, "--endpoint"], cleanEnv)).exitCode).toBe(2);
      expect((await runCliAsync(["judge", planPath, "--xpto"], cleanEnv)).exitCode).toBe(2);
      const rBadBase = await runCliAsync(
        ["judge", planPath, "--ledger", ledgerPath, "--base", "nope"],
        cleanEnv,
      );
      expect(rBadBase.exitCode).toBe(2);
      expect(rBadBase.stderr).toContain("base inválida");

      // Case 24: Ledger verify ok
      const lv = await runCliAsync(["ledger", "verify", "--ledger", ledgerPath], cleanEnv);
      expect(lv.exitCode).toBe(0);
      expect(lv.stdout.trim().startsWith("ok ")).toBe(true);
    } finally {
      server.stop(true);
      cleanup();
    }
  });
});
