import { describe, expect, test } from "bun:test";
import {
  MAX_RECEIPT_BYTES,
  MAX_TEXT,
  REASON_CODES,
  STATUSES,
  type Receipt,
  validateReceipt,
} from "../src/receipt";

function makeValidReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    type: "task.receipt",
    id: "rcpt-0001",
    task: "T01",
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [
      {
        kind: "command",
        cmd_sha256: "a".repeat(64),
        exit: 0,
        duration_ms: 42,
        artifact_ref: {
          path: "runs/T01/1/out.txt",
          sha256: "b".repeat(64),
        },
      },
    ],
    tokens: {
      in: null,
      out: null,
      cache: null,
      source: null,
    },
    cost_usd: null,
    cost_evidence: "not run",
    author: {
      model: "glm-5.3-flash",
      family: "glm",
    },
    verified_by: null,
    summary: "T01 pass: done_when exit 0 em 0s",
    created_at: "2026-10-24T17:16:00.000Z",
    ...overrides,
  };
}

describe("T01 — receipt schema v1 & validator", () => {
  test("constants STATUSES, REASON_CODES, MAX_RECEIPT_BYTES, MAX_TEXT are exported", () => {
    expect(STATUSES).toEqual(["pass", "fail", "blocked", "not run"]);
    expect(REASON_CODES).toEqual([
      "command_failed",
      "plan_invalid",
      "budget",
      "breaker_same_failure",
      "scope_drift",
      "tests_frozen_changed",
      "same_family_judge",
      "infra",
      "not_executed",
    ]);
    expect(MAX_RECEIPT_BYTES).toBe(4096);
    expect(MAX_TEXT).toBe(280);
  });

  test("1. minimal valid receipt with status 'pass' and reason_code null -> ok: true", () => {
    const input = makeValidReceipt();
    const res = validateReceipt(input);
    expect(res.ok).toBe(true);
    if (res.ok) {
      const r: Receipt = res.receipt;
      expect(r.status).toBe("pass");
      expect(r.reason_code).toBeNull();
    }

    // Also valid with known optional fields
    const withOptionals = makeValidReceipt({
      flow: "padrao",
      mode_effective: "padrao",
      breaker: { tripped: false, failure_signature: null },
      checkpoint_ref: "abc1234",
      next_action: "proceed",
      question: { text: "Approve?", options: ["yes", "no"] },
      verified_by: { model: "gemini-4-argon", family: "gemini" },
      tokens: { in: 100, out: 50, cache: 0, source: "host-structured" },
    });
    expect(validateReceipt(withOptionals).ok).toBe(true);
  });

  test("2. invalid status values ('passed', 'not_run') -> error", () => {
    const r1 = validateReceipt(makeValidReceipt({ status: "passed" }));
    expect(r1.ok).toBe(false);

    const r2 = validateReceipt(
      makeValidReceipt({ status: "not_run", reason_code: "not_executed" }),
    );
    expect(r2.ok).toBe(false);

    const r3 = validateReceipt(
      makeValidReceipt({ status: "not run", reason_code: "not_executed" }),
    );
    expect(r3.ok).toBe(true);
  });

  test("3. status 'pass' with non-null reason_code -> error", () => {
    const res = validateReceipt(
      makeValidReceipt({ status: "pass", reason_code: "command_failed" }),
    );
    expect(res.ok).toBe(false);
  });

  test("4. status !== 'pass' with null or unknown reason_code -> error", () => {
    const failNull = validateReceipt(makeValidReceipt({ status: "fail", reason_code: null }));
    expect(failNull.ok).toBe(false);

    const failFoo = validateReceipt(makeValidReceipt({ status: "fail", reason_code: "foo" }));
    expect(failFoo.ok).toBe(false);

    const blockedNull = validateReceipt(
      makeValidReceipt({ status: "blocked", reason_code: null }),
    );
    expect(blockedNull.ok).toBe(false);

    const notRunNull = validateReceipt(
      makeValidReceipt({ status: "not run", reason_code: null }),
    );
    expect(notRunNull.ok).toBe(false);

    const failValid = validateReceipt(
      makeValidReceipt({ status: "fail", reason_code: "command_failed" }),
    );
    expect(failValid.ok).toBe(true);
  });

  test("5. unknown field at root ('extra') or inside sub-objects ('tokens', etc.) -> error mentioning the field", () => {
    const rootExtra = validateReceipt(makeValidReceipt({ extra: 1 }));
    expect(rootExtra.ok).toBe(false);
    if (!rootExtra.ok) {
      expect(rootExtra.errors.some((e) => e.includes("extra"))).toBe(true);
    }

    const tokensExtra = validateReceipt(
      makeValidReceipt({
        tokens: { in: null, out: null, cache: null, source: null, bonus: 1 },
      }),
    );
    expect(tokensExtra.ok).toBe(false);
    if (!tokensExtra.ok) {
      expect(tokensExtra.errors.some((e) => e.includes("bonus"))).toBe(true);
    }

    const authorExtra = validateReceipt(
      makeValidReceipt({
        author: { model: "x", family: "x", unknown_author_key: true },
      }),
    );
    expect(authorExtra.ok).toBe(false);
    if (!authorExtra.ok) {
      expect(authorExtra.errors.some((e) => e.includes("unknown_author_key"))).toBe(true);
    }
  });

  test("6. JSON.stringify(receipt) > 4096 bytes -> error", () => {
    const manyEvidence = Array.from({ length: 30 }, (_, i) => ({
      kind: "command",
      cmd_sha256: "a".repeat(64),
      exit: 0,
      duration_ms: i,
      artifact_ref: {
        path: `runs/T01/${i}/out.txt`,
        sha256: "b".repeat(64),
      },
    }));
    const huge = makeValidReceipt({ evidence: manyEvidence });
    expect(Buffer.byteLength(JSON.stringify(huge), "utf8")).toBeGreaterThan(4096);
    const res = validateReceipt(huge);
    expect(res.ok).toBe(false);
  });

  test("7. summary and question.text length boundaries (280 -> ok, 281 -> error)", () => {
    const ok280 = validateReceipt(makeValidReceipt({ summary: "x".repeat(280) }));
    expect(ok280.ok).toBe(true);

    const err281 = validateReceipt(makeValidReceipt({ summary: "x".repeat(281) }));
    expect(err281.ok).toBe(false);

    const qOk280 = validateReceipt(
      makeValidReceipt({ question: { text: "q".repeat(280), options: ["a"] } }),
    );
    expect(qOk280.ok).toBe(true);

    const qErr281 = validateReceipt(
      makeValidReceipt({ question: { text: "q".repeat(281), options: ["a"] } }),
    );
    expect(qErr281.ok).toBe(false);
  });

  test("8. tokens.source === null with tokens.in === 0 -> error (I4: no invented zero); all null -> ok", () => {
    const inventedZero = validateReceipt(
      makeValidReceipt({
        tokens: { in: 0, out: null, cache: null, source: null },
      }),
    );
    expect(inventedZero.ok).toBe(false);

    const allNull = validateReceipt(
      makeValidReceipt({
        tokens: { in: null, out: null, cache: null, source: null },
      }),
    );
    expect(allNull.ok).toBe(true);
  });

  test("9. tokens.in negative (-1) or float (1.5) -> error", () => {
    const neg = validateReceipt(
      makeValidReceipt({
        tokens: { in: -1, out: 10, cache: 0, source: "host-structured" },
      }),
    );
    expect(neg.ok).toBe(false);

    const flt = validateReceipt(
      makeValidReceipt({
        tokens: { in: 1.5, out: 10, cache: 0, source: "host-structured" },
      }),
    );
    expect(flt.ok).toBe(false);
  });

  test("10. v: 2 or type: 'task.request' -> error", () => {
    expect(validateReceipt(makeValidReceipt({ v: 2 })).ok).toBe(false);
    expect(validateReceipt(makeValidReceipt({ type: "task.request" })).ok).toBe(false);
  });

  test("11. evidence[0].cmd_sha256 with 63 chars -> error", () => {
    const badEvidence = validateReceipt(
      makeValidReceipt({
        evidence: [
          {
            kind: "command",
            cmd_sha256: "a".repeat(63),
            exit: 0,
            duration_ms: 10,
            artifact_ref: null,
          },
        ],
      }),
    );
    expect(badEvidence.ok).toBe(false);
  });

  test("12. attempts: 0 -> error", () => {
    expect(validateReceipt(makeValidReceipt({ attempts: 0 })).ok).toBe(false);
  });

  test("13. errors are accumulated: receipt with 3 problems returns errors.length >= 3", () => {
    const multiBad = validateReceipt(
      makeValidReceipt({
        v: 2,
        attempts: 0,
        summary: "x".repeat(281),
      }),
    );
    expect(multiBad.ok).toBe(false);
    if (!multiBad.ok) {
      expect(multiBad.errors.length).toBeGreaterThanOrEqual(3);
    }
  });
});
