import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateReceipt } from "../src/receipt";
import {
  NOT_RUN_TOKENS,
  parseUsageJsonl,
  resolveUsageFile,
  tokenFieldsFor,
} from "../src/tokens";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

function sha256hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function makeTempFixture(task = "TX") {
  const repoDir = mkdtempSync(join(tmpdir(), "pinga-tokens-repo-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-tokens-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");

  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repoDir });
  mkdirSync(join(repoDir, "tasks", task), { recursive: true });
  const planPath = join(repoDir, "tasks", task, "PLAN.md");

  const writePlan = (doneWhen = "true", linesCount?: number) => {
    if (linesCount && linesCount > 25) {
      const content = [
        "---",
        "mode: padrao",
        'goal: "Too many lines"',
        'done_when: "true"',
        'touch: ["src/a.ts"]',
        "---",
        ...Array.from({ length: linesCount - 6 }, (_, i) => `- step ${i}`),
      ].join("\n");
      writeFileSync(planPath, `${content}\n`);
      return planPath;
    }
    const content = [
      "---",
      "mode: padrao",
      'goal: "Tokens test plan"',
      `done_when: ${JSON.stringify(doneWhen)}`,
      'touch: ["src/a.ts"]',
      'tests_frozen: ["tests/a.test.ts"]',
      "budget: { tokens: 100000, minutes: 5 }",
      "---",
      "## Passos",
      "- [ ] step",
    ].join("\n");
    writeFileSync(planPath, `${content}\n`);
    return planPath;
  };

  return {
    repoDir,
    planPath,
    ledgerPath,
    writePlan,
    cleanup: () => {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

const CLAUDE_FIXTURE_1 = [
  JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }),
  JSON.stringify({
    type: "assistant",
    message: {
      id: "m1",
      role: "assistant",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 20,
      },
    },
  }),
  // Duplicate m1 content block -> should be deduplicated
  JSON.stringify({
    type: "assistant",
    message: {
      id: "m1",
      role: "assistant",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 20,
      },
    },
  }),
  JSON.stringify({
    type: "assistant",
    message: {
      id: "m2",
      role: "assistant",
      usage: {
        input_tokens: 3,
        output_tokens: 2,
      },
    },
  }),
  JSON.stringify({ type: "summary", summary: "done" }),
].join("\n");

const PI_FIXTURE_3 = [
  JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      usage: {
        input: 10,
        output: 5,
        cacheRead: 3,
        cacheWrite: 2,
        cost: { total: 0.001 },
      },
    },
  }),
  JSON.stringify({ usage: { input: 1, output: 1 } }),
].join("\n");

const OPENCODE_FIXTURE_4 = [
  JSON.stringify({
    tokens: { input: 100, output: 20, cache: { read: 7, write: 1 } },
    cost_usd: 0.02,
  }),
  JSON.stringify({
    tokens: { input: 1, output: 1, cache: 4 },
    cost: 0.5,
  }),
].join("\n");

describe("T06 — Token measurement (I4 / Lei 1)", () => {
  test("1. Claude Code JSONL with deduplicated message.id, cache read+creation, and ignored user/summary lines", () => {
    const res = parseUsageJsonl(CLAUDE_FIXTURE_1);
    expect(res).toEqual({
      ok: true,
      totals: {
        in: 13,
        out: 7,
        cache: 120,
        cost_usd: null,
        lines: 2,
      },
    });
  });

  test("2. Claude Code with costUSD across two distinct messages -> cost_usd ~ 0.03", () => {
    const text = [
      JSON.stringify({
        message: { id: "a", usage: { input_tokens: 1, output_tokens: 1 } },
        costUSD: 0.01,
      }),
      JSON.stringify({
        message: { id: "b", usage: { input_tokens: 2, output_tokens: 2 } },
        costUSD: 0.02,
      }),
    ].join("\n");
    const res = parseUsageJsonl(text);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.totals.cost_usd).toBeCloseTo(0.03);
    }
  });

  test("3. pi format (message.usage and root usage)", () => {
    const res = parseUsageJsonl(PI_FIXTURE_3);
    expect(res).toEqual({
      ok: true,
      totals: {
        in: 11,
        out: 6,
        cache: 5,
        cost_usd: 0.001,
        lines: 2,
      },
    });
  });

  test("4. opencode/agy format (root tokens with cache object or number, cost_usd or cost)", () => {
    const res = parseUsageJsonl(OPENCODE_FIXTURE_4);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.totals.in).toBe(101);
      expect(res.totals.out).toBe(21);
      expect(res.totals.cache).toBe(12);
      expect(res.totals.cost_usd).toBeCloseTo(0.52);
    }
  });

  test("5. all three formats combined in the same file -> sums all", () => {
    const combined = [CLAUDE_FIXTURE_1, PI_FIXTURE_3, OPENCODE_FIXTURE_4].join("\n");
    const res = parseUsageJsonl(combined);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.totals.in).toBe(13 + 11 + 101);
      expect(res.totals.out).toBe(7 + 6 + 21);
      expect(res.totals.cache).toBe(120 + 5 + 12);
      expect(res.totals.cost_usd).toBeCloseTo(0.521);
      expect(res.totals.lines).toBe(6);
    }
  });

  test("6. usage lines with no cache and no cost -> cache: null and cost_usd: null, numeric in/out", () => {
    const text = JSON.stringify({ usage: { input: 5, output: 10 } });
    const res = parseUsageJsonl(text);
    expect(res).toEqual({
      ok: true,
      totals: { in: 5, out: 10, cache: null, cost_usd: null, lines: 1 },
    });
  });

  test("7. invalid JSONL inputs return { ok: false, error }", () => {
    const badJson = [JSON.stringify({ usage: { input: 1, output: 1 } }), "{oops"].join("\n");
    const r1 = parseUsageJsonl(badJson);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain("linha 2");

    const rEmpty = parseUsageJsonl("");
    expect(rEmpty.ok).toBe(false);
    if (!rEmpty.ok) expect(rEmpty.error).toContain("nenhuma linha de uso");

    const rOnlyUser = parseUsageJsonl(JSON.stringify({ type: "user", text: "hello" }));
    expect(rOnlyUser.ok).toBe(false);
    if (!rOnlyUser.ok) expect(rOnlyUser.error).toContain("nenhuma linha de uso");

    const rNeg = parseUsageJsonl(
      JSON.stringify({ message: { usage: { input_tokens: -1, output_tokens: 1 } } }),
    );
    expect(rNeg.ok).toBe(false);

    const rFloat = parseUsageJsonl(JSON.stringify({ usage: { input: 1.5, output: 1 } }));
    expect(rFloat.ok).toBe(false);
  });

  test("8. blank lines in the middle and trailing newline do not change results", () => {
    const withBlanks = `\n\n${CLAUDE_FIXTURE_1}\n\n`;
    expect(parseUsageJsonl(withBlanks)).toEqual(parseUsageJsonl(CLAUDE_FIXTURE_1));
  });

  test("9. resolveUsageFile prioritizes flag over PINGA_USAGE_FILE and ignores empty strings", () => {
    expect(resolveUsageFile("a", { PINGA_USAGE_FILE: "b" })).toBe("a");
    expect(resolveUsageFile(undefined, { PINGA_USAGE_FILE: "b" })).toBe("b");
    expect(resolveUsageFile(undefined, {})).toBeNull();
    expect(resolveUsageFile("", { PINGA_USAGE_FILE: "" })).toBeNull();
  });

  test("10. tokenFieldsFor(null) equals NOT_RUN_TOKENS with tokens.in === null (never 0)", () => {
    expect(tokenFieldsFor(null)).toEqual(NOT_RUN_TOKENS);
    expect(tokenFieldsFor(null).tokens.in).toBeNull();
  });

  test("11 & 12. tokenFieldsFor valid file vs missing/invalid file", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinga-token-fields-"));
    try {
      const validPath = join(dir, "valid.jsonl");
      writeFileSync(validPath, CLAUDE_FIXTURE_1);

      const tf = tokenFieldsFor(validPath);
      expect(tf.tokens).toEqual({
        in: 13,
        out: 7,
        cache: 120,
        source: "host-structured",
      });
      expect(tf.cost_evidence).toBe(
        `host-structured:${resolve(validPath)}#${sha256hex(readFileSync(validPath))}`,
      );

      const sampleReceipt = {
        v: 1,
        type: "task.receipt",
        id: "r1",
        task: "TX",
        status: "pass",
        reason_code: null,
        attempts: 1,
        evidence: [],
        ...tf,
        author: { model: null, family: null },
        verified_by: null,
        summary: "TX pass",
        created_at: new Date().toISOString(),
      };
      expect(validateReceipt(sampleReceipt).ok).toBe(true);

      const missingTf = tokenFieldsFor("/nao/existe.jsonl");
      expect(missingTf.tokens).toEqual({ in: null, out: null, cache: null, source: null });
      expect(missingTf.cost_usd).toBeNull();
      expect(missingTf.cost_evidence.startsWith("invalid:")).toBe(true);
      expect(missingTf.cost_evidence.length).toBeLessThanOrEqual(280);

      const badPath = join(dir, "bad.jsonl");
      writeFileSync(badPath, "{oops\n");
      const badTf = tokenFieldsFor(badPath);
      expect(badTf.tokens).toEqual({ in: null, out: null, cache: null, source: null });
      expect(badTf.cost_usd).toBeNull();
      expect(badTf.cost_evidence.startsWith("invalid:")).toBe(true);
      expect(badTf.cost_evidence.length).toBeLessThanOrEqual(280);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("13, 14, 15, 16, 17, 18 & 19. CLI verify with --usage-file and PINGA_USAGE_FILE", () => {
    const { repoDir, ledgerPath, writePlan, cleanup } = makeTempFixture("TX");
    try {
      const f1 = join(repoDir, "u1.jsonl");
      const f3 = join(repoDir, "u3.jsonl");
      writeFileSync(f1, CLAUDE_FIXTURE_1);
      writeFileSync(f3, PI_FIXTURE_3);

      const cleanEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (k !== "PINGA_USAGE_FILE" && v !== undefined) cleanEnv[k] = v;
      }

      // 13. --usage-file f1
      let p = writePlan("true");
      const r13 = Bun.spawnSync(
        ["bun", BIN, "verify", p, "--ledger", ledgerPath, "--usage-file", f1],
        { cwd: ROOT, env: cleanEnv },
      );
      expect(r13.exitCode).toBe(0);
      const rcpt13 = JSON.parse(r13.stdout.toString().trim());
      expect(rcpt13.tokens).toEqual({ in: 13, out: 7, cache: 120, source: "host-structured" });
      expect(validateReceipt(rcpt13).ok).toBe(true);

      // 14a. PINGA_USAGE_FILE=f1 without flag
      const r14a = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], {
        cwd: ROOT,
        env: { ...cleanEnv, PINGA_USAGE_FILE: f1 },
      });
      expect(r14a.exitCode).toBe(0);
      expect(JSON.parse(r14a.stdout.toString().trim()).tokens).toEqual({
        in: 13,
        out: 7,
        cache: 120,
        source: "host-structured",
      });

      // 14b. PINGA_USAGE_FILE=f1 and --usage-file f3 -> f3 wins
      const r14b = Bun.spawnSync(
        ["bun", BIN, "verify", p, "--ledger", ledgerPath, "--usage-file", f3],
        { cwd: ROOT, env: { ...cleanEnv, PINGA_USAGE_FILE: f1 } },
      );
      expect(r14b.exitCode).toBe(0);
      expect(JSON.parse(r14b.stdout.toString().trim()).tokens).toEqual({
        in: 11,
        out: 6,
        cache: 5,
        source: "host-structured",
      });

      // 15. Neither flag nor env -> all null, cost_evidence: "not run"
      const r15 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], {
        cwd: ROOT,
        env: cleanEnv,
      });
      expect(r15.exitCode).toBe(0);
      const rcpt15 = JSON.parse(r15.stdout.toString().trim());
      expect(rcpt15.tokens).toEqual({ in: null, out: null, cache: null, source: null });
      expect(rcpt15.cost_usd).toBeNull();
      expect(rcpt15.cost_evidence).toBe("not run");

      // 16. --usage-file /nao/existe.jsonl -> exit 0, cost_evidence invalid:..., stderr contains usage
      const r16 = Bun.spawnSync(
        ["bun", BIN, "verify", p, "--ledger", ledgerPath, "--usage-file", "/nao/existe.jsonl"],
        { cwd: ROOT, env: cleanEnv },
      );
      expect(r16.exitCode).toBe(0);
      const rcpt16 = JSON.parse(r16.stdout.toString().trim());
      expect(rcpt16.cost_evidence.startsWith("invalid:")).toBe(true);
      expect(r16.stderr.toString().toLowerCase()).toContain("usage");

      // 17. done_when: "exit 7" with --usage-file -> exit 1 & tokens filled; 26-line plan -> exit 3 & tokens filled
      p = writePlan("exit 7");
      const r17a = Bun.spawnSync(
        ["bun", BIN, "verify", p, "--ledger", ledgerPath, "--usage-file", f1],
        { cwd: ROOT, env: cleanEnv },
      );
      expect(r17a.exitCode).toBe(1);
      expect(JSON.parse(r17a.stdout.toString().trim()).tokens.in).toBe(13);

      p = writePlan("true", 26);
      const r17b = Bun.spawnSync(
        ["bun", BIN, "verify", p, "--ledger", ledgerPath, "--usage-file", f1],
        { cwd: ROOT, env: cleanEnv },
      );
      expect(r17b.exitCode).toBe(3);
      expect(JSON.parse(r17b.stdout.toString().trim()).tokens.in).toBe(13);

      // 18. --usage-file without value -> exit 2
      const r18 = Bun.spawnSync(
        ["bun", BIN, "verify", p, "--ledger", ledgerPath, "--usage-file"],
        { cwd: ROOT, env: cleanEnv },
      );
      expect(r18.exitCode).toBe(2);

      // 19. ledger verify ok
      const lv = Bun.spawnSync(["bun", BIN, "ledger", "verify", "--ledger", ledgerPath], {
        cwd: ROOT,
      });
      expect(lv.exitCode).toBe(0);
      expect(lv.stdout.toString().trim()).toBe("ok 7");
    } finally {
      cleanup();
    }
  });
});
