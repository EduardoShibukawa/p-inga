import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BREAKER_EXIT,
  BREAKER_NEXT_ACTION,
  computeFailureSignature,
  lastReceiptFor,
  shouldTrip,
} from "../src/breaker";
import { canonicalJson } from "../src/canonical";
import { openLedger } from "../src/ledger";
import { type Receipt, validateReceipt } from "../src/receipt";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function makeTempFixture(task = "TX") {
  const repoDir = mkdtempSync(join(tmpdir(), "pinga-breaker-repo-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-breaker-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");

  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repoDir });
  mkdirSync(join(repoDir, "tasks", task), { recursive: true });
  const planPath = join(repoDir, "tasks", task, "PLAN.md");

  const writePlan = (doneWhen: string, targetTask = task): string => {
    const dir = join(repoDir, "tasks", targetTask);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "PLAN.md");
    const content = [
      "---",
      "mode: padrao",
      'goal: "Breaker test plan"',
      `done_when: ${JSON.stringify(doneWhen)}`,
      'touch: ["src/a.ts"]',
      'tests_frozen: ["tests/a.test.ts"]',
      "budget: { tokens: 100000, minutes: 5 }",
      "---",
      "## Passos",
      "- [ ] step",
    ].join("\n");
    writeFileSync(p, `${content}\n`);
    return p;
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
    author: { model: null, family: null },
    verified_by: null,
    summary: "TX pass: done_when exit 0 em 0s",
    created_at: "2026-10-24T20:00:00.000Z",
    ...overrides,
  } as Receipt;
}

describe("T05 — Automatic Circuit Breaker (I3 / Lei 3)", () => {
  test("1. computeFailureSignature is deterministic, 64 hex, matches sha256(canonicalJson(...)) and changes when any field changes", () => {
    expect(BREAKER_EXIT).toBe(4);
    expect(BREAKER_NEXT_ACTION).toBe("escalar ao dono");

    const sig1 = computeFailureSignature({
      exit: 7,
      out_sha256: "b".repeat(64),
      reason_code: "command_failed",
    });
    expect(sig1).toMatch(/^[0-9a-f]{64}$/);

    const expected = sha256hex(
      canonicalJson({
        reason_code: "command_failed",
        out_sha256: "b".repeat(64),
        exit: 7,
      }),
    );
    expect(sig1).toBe(expected);

    expect(
      computeFailureSignature({
        exit: 8,
        out_sha256: "b".repeat(64),
        reason_code: "command_failed",
      }),
    ).not.toBe(sig1);

    expect(
      computeFailureSignature({
        exit: 7,
        out_sha256: "c".repeat(64),
        reason_code: "command_failed",
      }),
    ).not.toBe(sig1);

    expect(
      computeFailureSignature({
        exit: 7,
        out_sha256: "b".repeat(64),
        reason_code: "budget",
      }),
    ).not.toBe(sig1);
  });

  test("2. shouldTrip checks previous receipt status and breaker.failure_signature", () => {
    const sig = "f".repeat(64);
    expect(shouldTrip(null, sig)).toBe(false);
    expect(shouldTrip(makeReceipt({ status: "pass", reason_code: null }), sig)).toBe(false);

    expect(
      shouldTrip(
        makeReceipt({
          status: "fail",
          reason_code: "command_failed",
          breaker: { tripped: false, failure_signature: sig },
        }),
        sig,
      ),
    ).toBe(true);

    expect(
      shouldTrip(
        makeReceipt({
          status: "fail",
          reason_code: "command_failed",
          breaker: { tripped: false, failure_signature: "0".repeat(64) },
        }),
        sig,
      ),
    ).toBe(false);

    expect(
      shouldTrip(makeReceipt({ status: "fail", reason_code: "command_failed" }), sig),
    ).toBe(false);

    expect(
      shouldTrip(
        makeReceipt({
          status: "blocked",
          reason_code: "breaker_same_failure",
          breaker: { tripped: true, failure_signature: sig },
        }),
        sig,
      ),
    ).toBe(true);

    expect(shouldTrip(makeReceipt({ status: "blocked", reason_code: "budget" }), sig)).toBe(
      false,
    );
  });

  test("3. lastReceiptFor returns the receipt with highest seq for the given task, or null", () => {
    const { ledgerPath, cleanup } = makeTempFixture();
    try {
      const ledger = openLedger(ledgerPath);
      const r1 = makeReceipt({ id: "r1", task: "TX", attempts: 1 });
      const r2 = makeReceipt({ id: "r2", task: "TY", attempts: 1 });
      const r3 = makeReceipt({ id: "r3", task: "TX", attempts: 2 });

      ledger.append(r1);
      ledger.append(r2);
      ledger.append(r3);

      expect(lastReceiptFor(ledger, "TX")?.id).toBe("r3");
      expect(lastReceiptFor(ledger, "TY")?.id).toBe("r2");
      expect(lastReceiptFor(ledger, "TZ")).toBeNull();
      ledger.close();
    } finally {
      cleanup();
    }
  });

  test("4, 5 & 6. CLI consecutive identical failures: 1st -> exit 1 (tripped: false), 2nd -> exit 4 (tripped: true, breaker_same_failure), 3rd -> exit 4 again", () => {
    const { ledgerPath, writePlan, cleanup } = makeTempFixture("TX");
    try {
      const p = writePlan("echo boom; exit 7");

      // 1st run -> exit 1
      const r1 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r1.exitCode).toBe(1);
      const rcpt1 = JSON.parse(r1.stdout.toString().trim());
      expect(rcpt1.status).toBe("fail");
      expect(rcpt1.reason_code).toBe("command_failed");
      expect(rcpt1.breaker?.tripped).toBe(false);
      const expectedSig = computeFailureSignature({
        exit: 7,
        out_sha256: rcpt1.evidence[0].artifact_ref.sha256,
        reason_code: "command_failed",
      });
      expect(rcpt1.breaker?.failure_signature).toBe(expectedSig);
      expect(validateReceipt(rcpt1).ok).toBe(true);

      // 2nd run -> exit 4 (tripped)
      const r2 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r2.exitCode).toBe(4);
      const rcpt2 = JSON.parse(r2.stdout.toString().trim());
      expect(rcpt2.status).toBe("blocked");
      expect(rcpt2.reason_code).toBe("breaker_same_failure");
      expect(rcpt2.breaker).toEqual({ tripped: true, failure_signature: expectedSig });
      expect(rcpt2.next_action).toBe("escalar ao dono");
      expect(rcpt2.summary).toContain("disjuntor");
      expect(rcpt2.attempts).toBe(2);
      expect(rcpt2.evidence[0].exit).toBe(7);
      expect(rcpt2.evidence[0].artifact_ref.path).toBe("runs/TX/2/out.txt");
      expect(validateReceipt(rcpt2).ok).toBe(true);

      // 3rd run -> exit 4 again
      const r3 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r3.exitCode).toBe(4);
      const rcpt3 = JSON.parse(r3.stdout.toString().trim());
      expect(rcpt3.status).toBe("blocked");
      expect(rcpt3.reason_code).toBe("breaker_same_failure");
      expect(rcpt3.breaker?.tripped).toBe(true);
      expect(validateReceipt(rcpt3).ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("7. variable output across two failures -> both exit 1, tripped: false, signatures differ", () => {
    const { ledgerPath, writePlan, cleanup } = makeTempFixture("TX");
    try {
      const p = writePlan("n=$(cat c 2>/dev/null || echo 0); echo $((n+1)) > c; echo $n; exit 1");

      const r1 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r1.exitCode).toBe(1);
      const rcpt1 = JSON.parse(r1.stdout.toString().trim());
      expect(rcpt1.breaker?.tripped).toBe(false);

      const r2 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r2.exitCode).toBe(1);
      const rcpt2 = JSON.parse(r2.stdout.toString().trim());
      expect(rcpt2.breaker?.tripped).toBe(false);
      expect(rcpt2.breaker?.failure_signature).not.toBe(rcpt1.breaker?.failure_signature);
      expect(validateReceipt(rcpt1).ok).toBe(true);
      expect(validateReceipt(rcpt2).ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("8. different exit code with same output (exit 3 then exit 4) -> both exit 1, tripped: false", () => {
    const { ledgerPath, writePlan, cleanup } = makeTempFixture("TX");
    try {
      const p1 = writePlan("exit 3");
      const r1 = Bun.spawnSync(["bun", BIN, "verify", p1, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r1.exitCode).toBe(1);

      const p2 = writePlan("exit 4");
      const r2 = Bun.spawnSync(["bun", BIN, "verify", p2, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r2.exitCode).toBe(1);
      const rcpt2 = JSON.parse(r2.stdout.toString().trim());
      expect(rcpt2.breaker?.tripped).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("9. pass in between resets breaker: exit 7 (exit 1) -> true (exit 0, no breaker field) -> exit 7 (exit 1, tripped: false)", () => {
    const { ledgerPath, writePlan, cleanup } = makeTempFixture("TX");
    try {
      let p = writePlan("exit 7");
      const r1 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r1.exitCode).toBe(1);

      p = writePlan("true");
      const r2 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r2.exitCode).toBe(0);
      const rcpt2 = JSON.parse(r2.stdout.toString().trim());
      expect(rcpt2.breaker).toBeUndefined();

      p = writePlan("exit 7");
      const r3 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r3.exitCode).toBe(1);
      const rcpt3 = JSON.parse(r3.stdout.toString().trim());
      expect(rcpt3.breaker?.tripped).toBe(false);
    } finally {
      cleanup();
    }
  });

  test("10. different task in between does not interfere: TX exit 7 -> TY exit 7 -> TX exit 7 (trips with exit 4)", () => {
    const { ledgerPath, writePlan, cleanup } = makeTempFixture("TX");
    try {
      const pTX = writePlan("exit 7", "TX");
      const pTY = writePlan("exit 7", "TY");

      const r1 = Bun.spawnSync(["bun", BIN, "verify", pTX, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r1.exitCode).toBe(1);

      const rY = Bun.spawnSync(["bun", BIN, "verify", pTY, "--ledger", ledgerPath], { cwd: ROOT });
      expect(rY.exitCode).toBe(1);

      const r2 = Bun.spawnSync(["bun", BIN, "verify", pTX, "--ledger", ledgerPath], { cwd: ROOT });
      expect(r2.exitCode).toBe(4);
    } finally {
      cleanup();
    }
  });

  test("11 & 12. repeated timeout -> both exit 2, blocked/budget, without breaker field, and ledger verify ok", () => {
    const { ledgerPath, writePlan, cleanup } = makeTempFixture("TX");
    try {
      const p = writePlan("sleep 5");
      const env = { ...process.env, PINGA_TIMEOUT_MS: "200" };

      const r1 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], {
        cwd: ROOT,
        env,
      });
      expect(r1.exitCode).toBe(2);
      const rcpt1 = JSON.parse(r1.stdout.toString().trim());
      expect(rcpt1.status).toBe("blocked");
      expect(rcpt1.reason_code).toBe("budget");
      expect(rcpt1.breaker).toBeUndefined();
      expect(validateReceipt(rcpt1).ok).toBe(true);

      const r2 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledgerPath], {
        cwd: ROOT,
        env,
      });
      expect(r2.exitCode).toBe(2);
      const rcpt2 = JSON.parse(r2.stdout.toString().trim());
      expect(rcpt2.status).toBe("blocked");
      expect(rcpt2.reason_code).toBe("budget");
      expect(rcpt2.breaker).toBeUndefined();
      expect(validateReceipt(rcpt2).ok).toBe(true);

      const lv = Bun.spawnSync(["bun", BIN, "ledger", "verify", "--ledger", ledgerPath], {
        cwd: ROOT,
      });
      expect(lv.exitCode).toBe(0);
      expect(lv.stdout.toString().trim()).toBe("ok 2");
    } finally {
      cleanup();
    }
  });
});
