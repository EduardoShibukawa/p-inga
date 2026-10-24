import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type EvalDoc,
  PLANNER_DEFAULT,
  extractOwnerFields,
  parseEval,
  renderEval,
  summarizeTokens,
  validateEval,
} from "../src/eval";
import { openLedger } from "../src/ledger";
import type { Receipt } from "../src/receipt";

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

function makeTempFixture(task = "TX") {
  const repoDir = mkdtempSync(join(tmpdir(), "pinga-eval-repo-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-eval-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");

  git(repoDir, ["init", "-q", "-b", "main"]);
  git(repoDir, ["config", "user.email", "test@example.com"]);
  git(repoDir, ["config", "user.name", "Test User"]);

  mkdirSync(join(repoDir, "tasks", task), { recursive: true });
  const planPath = join(repoDir, "tasks", task, "PLAN.md");
  const evalPath = join(repoDir, "tasks", task, "EVAL.md");

  const planContent = [
    "---",
    "mode: padrao",
    'goal: "Eval test plan"',
    'done_when: "true"',
    'touch: ["src/a.ts"]',
    'tests_frozen: ["tests/a.test.ts"]',
    "budget: { tokens: 100000, minutes: 5 }",
    "---",
    "## Passos",
    "- [ ] step",
  ].join("\n");
  writeFileSync(planPath, `${planContent}\n`);

  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "PINGA_PLANNER_MODEL" && k !== "PINGA_PLANNER_FAMILY" && v !== undefined) {
      cleanEnv[k] = v;
    }
  }

  return {
    repoDir,
    planPath,
    evalPath,
    ledgerPath,
    cleanEnv,
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
        duration_ms: 10000,
        artifact_ref: {
          path: "runs/TX/1/out.txt",
          sha256: "b".repeat(64),
        },
      },
    ],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: "glm-5.3", family: "glm" },
    verified_by: null,
    summary: "TX pass: done_when exit 0 em 10s",
    created_at: "2026-10-24T21:00:00.000Z",
    ...overrides,
  } as Receipt;
}

describe("T07 — pinga eval (render, parse, validate, generate & --check)", () => {
  test("1 & 2. renderEval and parseEval round-trip and formatting rules", () => {
    expect(PLANNER_DEFAULT).toEqual({ model: "gemini-4-argon", family: "gemini" });

    const doc1: EvalDoc = {
      task: "TX",
      executor: "glm-5.3 (glm)",
      planner: "gemini-4-argon (gemini)",
      status: "pass",
      attempts: 1,
      minutes: 2,
      tokens: "not run",
      scope: { tests_frozen: "intacto", out_of_touch: [] },
      parecer: "ok",
      dono: { bom: "", ruim: "", mudar: "" },
    };
    const rendered1 = renderEval(doc1);
    expect(rendered1.endsWith("dono:\n  bom:\n  ruim:\n  mudar:\n")).toBe(true);
    expect(rendered1.split("\n")[2]?.startsWith("auto:   status ")).toBe(true);
    expect(parseEval(rendered1)).toEqual({ ok: true, doc: doc1 });

    const doc2: EvalDoc = {
      ...doc1,
      tokens: "in=1 out=2 cache=null usd=0.5",
      scope: { tests_frozen: "ALTERADO", out_of_touch: ["README.md", "src/b.ts"] },
      dono: { bom: "rápido", ruim: "verboso", mudar: "nada" },
    };
    expect(parseEval(renderEval(doc2))).toEqual({ ok: true, doc: doc2 });

    const doc3: EvalDoc = {
      ...doc1,
      scope: { tests_frozen: "sem base", out_of_touch: null },
    };
    expect(parseEval(renderEval(doc3))).toEqual({ ok: true, doc: doc3 });
  });

  test("3. validateEval rejects malformed inputs and accumulates errors", () => {
    const validText = renderEval({
      task: "TX",
      executor: "glm-5.3 (glm)",
      planner: "gemini-4-argon (gemini)",
      status: "pass",
      attempts: 1,
      minutes: 1,
      tokens: "not run",
      scope: { tests_frozen: "intacto", out_of_touch: [] },
      parecer: "ok",
      dono: { bom: "", ruim: "", mudar: "" },
    });

    expect(validateEval(validText, "TX").ok).toBe(true);
    expect(validateEval(validText, "TY").ok).toBe(false);

    expect(validateEval(validText.replace("## EVAL TX", "EVAL TX")).ok).toBe(false);
    expect(validateEval(validText.replace("status pass", "status passed")).ok).toBe(false);
    expect(validateEval(validText.replace("tentativas 1", "tentativas 0")).ok).toBe(false);
    expect(validateEval(validText.replace("  mudar:\n", "")).ok).toBe(false);
    expect(validateEval(`${validText}extra line\n`).ok).toBe(false);
    expect(validateEval(validText.replace("tokens not run", "tokens 0")).ok).toBe(false);
    expect(validateEval(validText.replace("tests_frozen intacto", "tests_frozen talvez")).ok).toBe(
      false,
    );

    const multiBad = validText
      .replace("status pass", "status passed")
      .replace("tentativas 1", "tentativas 0")
      .replace("tokens not run", "tokens 0");
    const res = validateEval(multiBad, "TY");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("4. compatibility: existing tasks/T00..T03/EVAL.md in repo pass validateEval", () => {
    for (const t of ["T00", "T01", "T02", "T03"]) {
      const text = readFileSync(join(ROOT, "tasks", t, "EVAL.md"), "utf8");
      const res = validateEval(text, t);
      expect(res).toEqual({ ok: true });
    }
  });

  test("5. summarizeTokens handles all-null receipts vs host-structured receipts with rounding", () => {
    const rNull = makeReceipt();
    expect(summarizeTokens([rNull])).toBe("not run");

    const r1 = makeReceipt({
      tokens: { in: 100, out: 20, cache: null, source: "host-structured" },
      cost_usd: 0.01,
      cost_evidence: "host-structured:a#1",
    });
    const r2 = makeReceipt({
      tokens: { in: 50, out: 5, cache: 3, source: "host-structured" },
      cost_usd: null,
      cost_evidence: "host-structured:b#2",
    });
    expect(summarizeTokens([r1, r2])).toBe("in=150 out=25 cache=3 usd=0.01");

    const r3 = makeReceipt({
      tokens: { in: 1, out: 1, cache: null, source: "host-structured" },
      cost_usd: 0.1,
      cost_evidence: "host-structured:c#3",
    });
    const r4 = makeReceipt({
      tokens: { in: 1, out: 1, cache: null, source: "host-structured" },
      cost_usd: 0.2,
      cost_evidence: "host-structured:d#4",
    });
    expect(summarizeTokens([r3, r4])).toBe("in=2 out=2 cache=null usd=0.3");
  });

  test("6, 7, 8, 9, 10, 12, 13, 14 & 15. CLI pinga eval generation, preservation, family rules, --check and error flags", () => {
    const { planPath, evalPath, ledgerPath, cleanEnv, cleanup } = makeTempFixture("TX");
    try {
      // 12. No receipts for TX -> exit 1, stderr "sem recibos", EVAL.md not written
      const rNoRcpt = Bun.spawnSync(["bun", BIN, "eval", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
        env: cleanEnv,
      });
      expect(rNoRcpt.exitCode).toBe(1);
      expect(rNoRcpt.stderr.toString()).toContain("sem recibos");
      expect(existsSync(evalPath)).toBe(false);

      // 6. Populate ledger with TX fail (30s), TX pass (50s, glm-5.3/glm), and TY
      const ledger = openLedger(ledgerPath);
      ledger.append(
        makeReceipt({
          task: "TX",
          status: "fail",
          reason_code: "command_failed",
          attempts: 1,
          evidence: [
            {
              kind: "command",
              cmd_sha256: "a".repeat(64),
              exit: 1,
              duration_ms: 30000,
              artifact_ref: null,
            },
          ],
        }),
      );
      ledger.append(
        makeReceipt({
          task: "TX",
          status: "pass",
          reason_code: null,
          attempts: 2,
          author: { model: "glm-5.3", family: "glm" },
          evidence: [
            {
              kind: "command",
              cmd_sha256: "a".repeat(64),
              exit: 0,
              duration_ms: 50000,
              artifact_ref: null,
            },
          ],
        }),
      );
      ledger.append(makeReceipt({ task: "TY", attempts: 1 }));
      ledger.close();

      const r6 = Bun.spawnSync(["bun", BIN, "eval", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
        env: cleanEnv,
      });
      expect(r6.exitCode).toBe(0);
      expect(r6.stdout.toString().trim()).toBe(evalPath);
      const text6 = readFileSync(evalPath, "utf8");
      expect(validateEval(text6, "TX")).toEqual({ ok: true });
      expect(text6).toContain("status pass · tentativas 2 · tempo 2 min · tokens not run");
      expect(text6).toContain("executor: glm-5.3 (glm) · planejador: gemini-4-argon (gemini)");
      expect(text6).toContain("escopo: tests_frozen sem base · fora do touch: sem base");
      expect(text6).toContain("parecer: pendente");

      // 13. Idempotence: second run produces identical bytes
      const r13 = Bun.spawnSync(["bun", BIN, "eval", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
        env: cleanEnv,
      });
      expect(r13.exitCode).toBe(0);
      expect(readFileSync(evalPath, "utf8")).toBe(text6);

      // 8. Preservation of existing parecer and dono fields when distinct family
      const customExisting = [
        "## EVAL TX",
        "executor: glm-5.3 (glm) · planejador: gemini-4-argon (gemini)",
        "auto:   status fail · tentativas 9 · tempo 9 min · tokens not run",
        "escopo: tests_frozen sem base · fora do touch: sem base",
        "parecer: código limpo",
        "dono:",
        "  bom:   rápido",
        "  ruim:  verboso",
        "  mudar: nada",
      ].join("\n");
      writeFileSync(evalPath, `${customExisting}\n`);

      const r8 = Bun.spawnSync(["bun", BIN, "eval", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
        env: cleanEnv,
      });
      expect(r8.exitCode).toBe(0);
      const text8 = readFileSync(evalPath, "utf8");
      expect(text8).toContain("status pass · tentativas 2 · tempo 2 min · tokens not run");
      expect(text8).toContain("parecer: código limpo");
      expect(text8).toContain("  bom:   rápido");
      expect(text8).toContain("  ruim:  verboso");
      expect(text8).toContain("  mudar: nada");

      // 7 & 10. Same family (PINGA_PLANNER_FAMILY=glm with executor glm) overwrites parecer to "n/a: mesma família"
      const r7 = Bun.spawnSync(["bun", BIN, "eval", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
        env: { ...cleanEnv, PINGA_PLANNER_FAMILY: "glm" },
      });
      expect(r7.exitCode).toBe(0);
      const text7 = readFileSync(evalPath, "utf8");
      expect(text7).toContain("planejador: gemini-4-argon (glm)");
      expect(text7).toContain("parecer: n/a: mesma família");

      // 9. Tolerant preservation on invalid EVAL.md ("lixo\n  bom: x\n")
      writeFileSync(evalPath, "lixo\n  bom: x\n");
      expect(extractOwnerFields("lixo\n  bom: x\n")).toEqual({
        bom: "x",
        ruim: "",
        mudar: "",
        parecer: null,
      });
      const r9 = Bun.spawnSync(["bun", BIN, "eval", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
        env: cleanEnv,
      });
      expect(r9.exitCode).toBe(0);
      const text9 = readFileSync(evalPath, "utf8");
      expect(validateEval(text9, "TX").ok).toBe(true);
      expect(text9).toContain("  bom:   x");
      expect(text9).toContain("  ruim:\n");
      expect(text9).toContain("parecer: pendente");

      // 14. --check mode
      const shaBefore = sha256hex(readFileSync(evalPath));
      const rCheckOk = Bun.spawnSync(
        ["bun", BIN, "eval", planPath, "--ledger", ledgerPath, "--check"],
        { cwd: ROOT, env: cleanEnv },
      );
      expect(rCheckOk.exitCode).toBe(0);
      expect(rCheckOk.stdout.toString().trim().startsWith("ok ")).toBe(true);
      expect(sha256hex(readFileSync(evalPath))).toBe(shaBefore);

      // Corrupted status
      const corrupted = text9.replace("status pass", "status passed");
      writeFileSync(evalPath, corrupted);
      const rCheckBad = Bun.spawnSync(
        ["bun", BIN, "eval", planPath, "--ledger", ledgerPath, "--check"],
        { cwd: ROOT, env: cleanEnv },
      );
      expect(rCheckBad.exitCode).toBe(1);
      expect(readFileSync(evalPath, "utf8")).toBe(corrupted);

      // Wrong task header
      writeFileSync(evalPath, text9.replace("## EVAL TX", "## EVAL TY"));
      const rCheckWrongTask = Bun.spawnSync(
        ["bun", BIN, "eval", planPath, "--ledger", ledgerPath, "--check"],
        { cwd: ROOT, env: cleanEnv },
      );
      expect(rCheckWrongTask.exitCode).toBe(1);

      // Missing EVAL.md
      rmSync(evalPath);
      const rCheckMissing = Bun.spawnSync(
        ["bun", BIN, "eval", planPath, "--ledger", ledgerPath, "--check"],
        { cwd: ROOT, env: cleanEnv },
      );
      expect(rCheckMissing.exitCode).toBe(1);
      expect(rCheckMissing.stderr.toString()).toContain("EVAL.md ausente");

      // 15. CLI invalid args -> exit 2
      expect(Bun.spawnSync(["bun", BIN, "eval"], { cwd: ROOT }).exitCode).toBe(2);
      expect(
        Bun.spawnSync(["bun", BIN, "eval", planPath, "--ledger"], { cwd: ROOT }).exitCode,
      ).toBe(2);
      expect(
        Bun.spawnSync(["bun", BIN, "eval", planPath, "--xpto"], { cwd: ROOT }).exitCode,
      ).toBe(2);
    } finally {
      cleanup();
    }
  });

  test("11. scope with RED base: detects tests_frozen ALTERADO and out_of_touch files while ignoring EXEC.md and EVAL.md", () => {
    const { repoDir, planPath, evalPath, ledgerPath, cleanEnv, cleanup } = makeTempFixture("TX");
    try {
      mkdirSync(join(repoDir, "src"), { recursive: true });
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(join(repoDir, "src/a.ts"), "export const a = 1;\n");
      writeFileSync(join(repoDir, "tests/a.test.ts"), "// init\n");
      git(repoDir, ["add", "tasks/TX/PLAN.md", "src/a.ts", "tests/a.test.ts"]);
      git(repoDir, ["commit", "-m", "chore: init"]);

      writeFileSync(join(repoDir, "tests/a.test.ts"), "// RED\n");
      git(repoDir, ["add", "tests/a.test.ts"]);
      git(repoDir, ["commit", "-m", "test(TX): RED"]);

      // After RED: modify tests/a.test.ts, create src/b.ts and tasks/TX/EXEC.md
      writeFileSync(join(repoDir, "tests/a.test.ts"), "// modified after RED\n");
      writeFileSync(join(repoDir, "src/b.ts"), "export const b = 2;\n");
      writeFileSync(join(repoDir, "tasks/TX/EXEC.md"), "exec draft\n");

      const ledger = openLedger(ledgerPath);
      ledger.append(makeReceipt({ task: "TX", status: "pass", reason_code: null }));
      ledger.close();

      const res = Bun.spawnSync(["bun", BIN, "eval", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
        env: cleanEnv,
      });
      expect(res.exitCode).toBe(0);
      const content = readFileSync(evalPath, "utf8");
      expect(content).toContain(
        "escopo: tests_frozen ALTERADO · fora do touch: src/b.ts, tests/a.test.ts",
      );
      expect(validateEval(content, "TX")).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });
});
