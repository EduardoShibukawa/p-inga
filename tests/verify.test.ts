import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";
import { parsePlan } from "../src/plan";
import { validateReceipt } from "../src/receipt";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");
const STABLE_SCRIPT = join(ROOT, "scripts/stable.ts");

function makeTempGitRepo(taskName = "TX"): {
  repoDir: string;
  planPath: string;
  ledgerPath: string;
  writePlan: (content: string) => void;
  cleanup: () => void;
} {
  const repoDir = mkdtempSync(join(tmpdir(), "pinga-verify-test-"));
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repoDir });
  const taskDir = join(repoDir, "tasks", taskName);
  mkdirSync(taskDir, { recursive: true });
  const planPath = join(taskDir, "PLAN.md");
  const ledgerPath = join(repoDir, ".pinga", "ledger.db");
  return {
    repoDir,
    planPath,
    ledgerPath,
    writePlan: (content: string) => writeFileSync(planPath, content, "utf8"),
    cleanup: () => rmSync(repoDir, { recursive: true, force: true }),
  };
}

function validPlanContent(doneWhen = "true", extra = ""): string {
  return [
    "---",
    "mode: padrao",
    'goal: "Test plan goal"',
    `done_when: ${JSON.stringify(doneWhen)}`,
    'touch: ["src/x.ts"]',
    'tests_frozen: ["tests/x.test.ts"]',
    "budget: { tokens: 100000, minutes: 5 }",
    "---",
    "## Passos",
    "- [ ] passo 1",
    ...(extra ? [extra] : []),
  ].join("\n");
}

function runVerify(
  planPath: string,
  ledgerPath: string,
  extraArgs: string[] = [],
  envOverrides: Record<string, string> = {},
) {
  return Bun.spawnSync(["bun", BIN, "verify", planPath, "--ledger", ledgerPath, ...extraArgs], {
    cwd: ROOT,
    env: { ...process.env, ...envOverrides },
  });
}

describe("T03 — parsePlan, pinga verify & scripts/stable.ts", () => {
  test("unit: parsePlan validates frontmatter, 25-line limit (ignoring trailing newline), mode, goal, done_when, touch", () => {
    const ok = parsePlan(`${validPlanContent("bun test")}\n`);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.plan.mode).toBe("padrao");
      expect(ok.plan.done_when).toBe("bun test");
      expect(ok.plan.touch).toEqual(["src/x.ts"]);
    }

    // Exactly 25 lines with trailing newline -> ok
    const lines25 = [
      "---",
      "mode: mvp",
      'goal: "25 lines test"',
      'done_when: "true"',
      "---",
      ...Array.from({ length: 20 }, (_, i) => `linha ${i + 6}`),
    ].join("\n");
    expect(parsePlan(`${lines25}\n`).ok).toBe(true);

    // 26 lines -> error
    expect(parsePlan(`${lines25}\nlinha 26\n`).ok).toBe(false);

    // padrao without touch -> error
    const noTouch = ["---", "mode: padrao", 'goal: "g"', 'done_when: "true"', "---"].join("\n");
    expect(parsePlan(noTouch).ok).toBe(false);
  });

  test("1. plan with 26 lines -> exit 3; receipt has status 'blocked', reason_code 'plan_invalid', evidence []; ledger has 1 row", () => {
    const { planPath, ledgerPath, writePlan, cleanup } = makeTempGitRepo("TX");
    try {
      const lines26 = [
        "---",
        "mode: padrao",
        'goal: "Goal"',
        'done_when: "true"',
        'touch: ["a.ts"]',
        "---",
        ...Array.from({ length: 20 }, (_, i) => `- item ${i}`),
      ].join("\n");
      writePlan(lines26);

      const res = runVerify(planPath, ledgerPath);
      expect(res.exitCode).toBe(3);

      const printed = JSON.parse(res.stdout.toString().trim());
      expect(printed.status).toBe("blocked");
      expect(printed.reason_code).toBe("plan_invalid");
      expect(printed.evidence).toEqual([]);
      expect(printed.summary.startsWith("TX blocked: plano inválido (")).toBe(true);
      expect(validateReceipt(printed).ok).toBe(true);

      const ledger = openLedger(ledgerPath);
      expect(ledger.all().length).toBe(1);
      ledger.close();
    } finally {
      cleanup();
    }
  });

  test("2. plan without done_when -> exit 3; plan with mode: rapido -> exit 3", () => {
    const { planPath, ledgerPath, writePlan, cleanup } = makeTempGitRepo("TX");
    try {
      const noDoneWhen = [
        "---",
        "mode: padrao",
        'goal: "No done_when"',
        'touch: ["a.ts"]',
        "---",
      ].join("\n");
      writePlan(noDoneWhen);
      const r1 = runVerify(planPath, ledgerPath);
      expect(r1.exitCode).toBe(3);

      const badMode = [
        "---",
        "mode: rapido",
        'goal: "Bad mode"',
        'done_when: "true"',
        'touch: ["a.ts"]',
        "---",
      ].join("\n");
      writePlan(badMode);
      const r2 = runVerify(planPath, ledgerPath);
      expect(r2.exitCode).toBe(3);
    } finally {
      cleanup();
    }
  });

  test("3. done_when: 'true' -> exit 0; receipt has status 'pass', reason_code null, evidence[0].exit 0", () => {
    const { planPath, ledgerPath, writePlan, cleanup } = makeTempGitRepo("TX");
    try {
      writePlan(validPlanContent("true"));
      const res = runVerify(planPath, ledgerPath, [], {
        PINGA_AUTHOR_MODEL: "kimi-k2.7-code",
        PINGA_AUTHOR_FAMILY: "kimi",
      });
      expect(res.exitCode).toBe(0);

      const rcpt = JSON.parse(res.stdout.toString().trim());
      expect(rcpt.task).toBe("TX");
      expect(rcpt.status).toBe("pass");
      expect(rcpt.reason_code).toBeNull();
      expect(rcpt.evidence.length).toBe(1);
      expect(rcpt.evidence[0].exit).toBe(0);
      expect(rcpt.author).toEqual({ model: "kimi-k2.7-code", family: "kimi" });
      expect(validateReceipt(rcpt).ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("4. done_when: 'exit 7' -> exit 1; receipt has status 'fail', reason_code 'command_failed', evidence[0].exit 7", () => {
    const { planPath, ledgerPath, writePlan, cleanup } = makeTempGitRepo("TX");
    try {
      writePlan(validPlanContent("exit 7"));
      const res = runVerify(planPath, ledgerPath);
      expect(res.exitCode).toBe(1);

      const rcpt = JSON.parse(res.stdout.toString().trim());
      expect(rcpt.status).toBe("fail");
      expect(rcpt.reason_code).toBe("command_failed");
      expect(rcpt.evidence[0].exit).toBe(7);
      expect(validateReceipt(rcpt).ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("5. done_when: 'sleep 5' with PINGA_TIMEOUT_MS=200 -> exit 2; receipt has 'blocked', 'budget' and evidence[0].exit === null", () => {
    const { planPath, ledgerPath, writePlan, cleanup } = makeTempGitRepo("TX");
    try {
      writePlan(validPlanContent("sleep 5"));
      const res = runVerify(planPath, ledgerPath, [], { PINGA_TIMEOUT_MS: "200" });
      expect(res.exitCode).toBe(2);

      const rcpt = JSON.parse(res.stdout.toString().trim());
      expect(rcpt.status).toBe("blocked");
      expect(rcpt.reason_code).toBe("budget");
      expect(rcpt.evidence[0].exit).toBeNull();
      expect(validateReceipt(rcpt).ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("6. done_when: 'yes | head -c 1000000' -> serialized receipt <= 4096 bytes and out.txt sha256 matches artifact_ref.sha256", () => {
    const { repoDir, planPath, ledgerPath, writePlan, cleanup } = makeTempGitRepo("TX");
    try {
      writePlan(validPlanContent("yes | head -c 1000000"));
      const res = runVerify(planPath, ledgerPath);
      expect(res.exitCode).toBe(0);

      const rawJson = res.stdout.toString().trim();
      expect(Buffer.byteLength(rawJson, "utf8")).toBeLessThanOrEqual(4096);

      const rcpt = JSON.parse(rawJson);
      expect(rcpt.evidence[0].artifact_ref.path).toBe("runs/TX/1/out.txt");

      const outFile = join(repoDir, "runs/TX/1/out.txt");
      expect(existsSync(outFile)).toBe(true);
      const fileBytes = readFileSync(outFile);
      expect(fileBytes.byteLength).toBe(1000000);
      const actualSha = createHash("sha256").update(fileBytes).digest("hex");
      expect(rcpt.evidence[0].artifact_ref.sha256).toBe(actualSha);
    } finally {
      cleanup();
    }
  });

  test("7 & 8. running twice increments attempts (1 then 2), writes runs/TX/1/out.txt and runs/TX/2/out.txt, all receipts validate and ledger verify is ok", () => {
    const { repoDir, planPath, ledgerPath, writePlan, cleanup } = makeTempGitRepo("TX");
    try {
      writePlan(validPlanContent("echo hello"));

      const r1 = runVerify(planPath, ledgerPath);
      expect(r1.exitCode).toBe(0);
      const rcpt1 = JSON.parse(r1.stdout.toString().trim());
      expect(rcpt1.attempts).toBe(1);
      expect(validateReceipt(rcpt1).ok).toBe(true);
      expect(existsSync(join(repoDir, "runs/TX/1/out.txt"))).toBe(true);

      const r2 = runVerify(planPath, ledgerPath);
      expect(r2.exitCode).toBe(0);
      const rcpt2 = JSON.parse(r2.stdout.toString().trim());
      expect(rcpt2.attempts).toBe(2);
      expect(validateReceipt(rcpt2).ok).toBe(true);
      expect(existsSync(join(repoDir, "runs/TX/2/out.txt"))).toBe(true);

      const verifyCli = Bun.spawnSync(
        ["bun", BIN, "ledger", "verify", "--ledger", ledgerPath],
        { cwd: ROOT },
      );
      expect(verifyCli.exitCode).toBe(0);
      expect(verifyCli.stdout.toString().trim()).toBe("ok 2");
    } finally {
      cleanup();
    }
  });

  test("9. scripts/stable.ts in a dirty temporary git repo -> exit 1 and 'árvore suja' on stderr", () => {
    const { repoDir, writePlan, cleanup } = makeTempGitRepo("TX");
    try {
      writePlan(validPlanContent("true")); // leaves untracked/modified file in repoDir
      const res = Bun.spawnSync(["bun", STABLE_SCRIPT], { cwd: repoDir });
      expect(res.exitCode).toBe(1);
      expect(res.stderr.toString()).toContain("árvore suja");
    } finally {
      cleanup();
    }
  });
});
