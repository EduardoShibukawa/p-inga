import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseExamples, partitionExamples } from "../src/examples";
import {
  PROVE_EXIT,
  WORKTREE_PREFIX,
  type ProofResult,
  type ProofVerdict,
  classifyBaseRun,
  combineProof,
  proveBase,
  provePlan,
  resolveProofBase,
  sweepStaleWorktrees,
  withTempWorktree,
} from "../src/prove";
import { receiptKind, validateReceipt } from "../src/receipt";

const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

function makeBaseReceipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    type: "task.receipt",
    id: "rcpt-t11-0001",
    task: "TX",
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: "glm-5.3-flash", family: "glm" },
    verified_by: null,
    summary: "TX pass",
    created_at: "2026-10-24T19:00:00.000Z",
    ...overrides,
  };
}

describe("T11 — prova falha no base em git worktree temporária (I15) — Unitários", () => {
  test("1. classifyBaseRun", () => {
    expect(PROVE_EXIT).toEqual({ proved: 0, infra: 8, test_passed_on_base: 10 });
    expect(WORKTREE_PREFIX).toBe("pinga-prove-");

    expect(classifyBaseRun({ exit: 0, timedOut: false })).toBe("test_passed_on_base");
    expect(classifyBaseRun({ exit: 1, timedOut: false })).toBe("proved");
    expect(classifyBaseRun({ exit: 7, timedOut: false })).toBe("proved");
    expect(classifyBaseRun({ exit: 126, timedOut: false })).toBe("inconclusive");
    expect(classifyBaseRun({ exit: 127, timedOut: false })).toBe("inconclusive");
    expect(classifyBaseRun({ exit: null, timedOut: false })).toBe("inconclusive");
    expect(classifyBaseRun({ exit: 1, timedOut: true })).toBe("inconclusive");
  });

  test("2. combineProof", () => {
    const cases: Array<
      [ProofVerdict, ProofVerdict | null, ProofVerdict, "done_when" | "holdout" | null]
    > = [
      ["proved", null, "proved", null],
      ["proved", "proved", "proved", null],
      ["proved", "test_passed_on_base", "test_passed_on_base", "holdout"],
      ["test_passed_on_base", "proved", "test_passed_on_base", "done_when"],
      ["test_passed_on_base", "inconclusive", "test_passed_on_base", "done_when"],
      ["inconclusive", "proved", "inconclusive", "done_when"],
      ["proved", "inconclusive", "inconclusive", "holdout"],
    ];

    for (const [dw, ho, expectedVerdict, expectedWhich] of cases) {
      expect(combineProof(dw, ho)).toEqual({
        verdict: expectedVerdict,
        which: expectedWhich,
      });
    }
  });

  test("3. receiptKind({ flow: 'prove_red' }) -> 'prove_red' e validateReceipt base_ref", () => {
    expect(receiptKind({ flow: "prove_red" })).toBe("prove_red");

    expect(
      validateReceipt(makeBaseReceipt({ base_ref: "a".repeat(40) })).ok,
    ).toBe(true);
    expect(validateReceipt(makeBaseReceipt({ base_ref: "abc" })).ok).toBe(false);
    expect(
      validateReceipt(makeBaseReceipt({ base_ref: "a".repeat(64) })).ok,
    ).toBe(false);
    expect(
      validateReceipt(makeBaseReceipt({ base_ref: "A".repeat(40) })).ok,
    ).toBe(false);
  });
});

describe("T11 — prova falha no base em git worktree temporária (I15) — Git worktree & CLI", () => {
  function makeStandardRepo(opts?: {
    withRed?: boolean;
    baseFnBody?: string;
    redTestBody?: string;
    touch?: string[];
    doneWhen?: string;
  }) {
    const baseDir = mkdtempSync(join(tmpdir(), "pinga-t11-repo-"));
    const repoDir = join(baseDir, "repo");
    const holdoutBase = join(baseDir, "holdout");
    const extDir = join(baseDir, "ext");
    const ledgerPath = join(baseDir, "ledger.db");
    mkdirSync(repoDir, { recursive: true });
    mkdirSync(holdoutBase, { recursive: true });
    mkdirSync(extDir, { recursive: true });

    const git = (...args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], {
        cwd: repoDir,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (r.exitCode !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${r.stderr.toString()}`);
      }
      return r.stdout.toString().trim();
    };

    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("checkout", "-q", "-b", "feat/x");

    writeFileSync(
      join(repoDir, ".gitignore"),
      "runs/\n.pinga/\n*.db\nran.flag\n",
    );
    mkdirSync(join(repoDir, "tasks/TX"), { recursive: true });
    mkdirSync(join(repoDir, "src"), { recursive: true });

    const planPath = join(repoDir, "tasks/TX/PLAN.md");
    const touch = opts?.touch ?? ["src/a.ts"];
    const doneWhen = opts?.doneWhen ?? "bun test tests/a.test.ts";

    writeFileSync(
      planPath,
      [
        "---",
        "mode: padrao",
        'goal: "Implementar f() === 2"',
        `done_when: ${JSON.stringify(doneWhen)}`,
        `touch: ${JSON.stringify(touch)}`,
        'tests_frozen: ["tests/a.test.ts"]',
        "---",
        "## Passos",
        "- [ ] 1",
        "## Dívidas conscientes",
        "- nenhuma",
        "## Fora",
        "- nada",
      ].join("\n"),
    );

    writeFileSync(
      join(repoDir, "src/a.ts"),
      opts?.baseFnBody ?? "export const f = () => 1;\n",
    );

    git("add", ".gitignore", "tasks/TX/PLAN.md", "src/a.ts");
    git("commit", "-q", "-m", "chore: init");
    const initSha = git("rev-parse", "HEAD");

    let redSha: string | null = null;
    if (opts?.withRed !== false) {
      mkdirSync(join(repoDir, "tests"), { recursive: true });
      writeFileSync(
        join(repoDir, "tests/a.test.ts"),
        opts?.redTestBody ??
          [
            'import { expect, test } from "bun:test";',
            'import { f } from "../src/a";',
            'test("f() === 2", () => { expect(f()).toBe(2); });',
          ].join("\n"),
      );
      git("add", "tests/a.test.ts");
      git("commit", "-q", "-m", "test(TX): RED");
      redSha = git("rev-parse", "HEAD");
    }

    const runCli = (args: string[], extraEnv: Record<string, string> = {}) => {
      const env: Record<string, string | undefined> = {
        ...process.env,
        PINGA_HOLDOUT_DIR: holdoutBase,
        ...extraEnv,
      };
      delete env.PINGA_MODE_NIGHT;
      const r = Bun.spawnSync(["bun", BIN, ...args], {
        cwd: repoDir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        exitCode: r.exitCode,
        stdout: r.stdout.toString(),
        stderr: r.stderr.toString(),
      };
    };

    return {
      baseDir,
      repoDir,
      holdoutBase,
      extDir,
      ledgerPath,
      planPath,
      initSha,
      redSha,
      git,
      runCli,
      cleanup: () => rmSync(baseDir, { recursive: true, force: true }),
    };
  }

  test("4–6. resolveProofBase, withTempWorktree, sweepStaleWorktrees", () => {
    const r = makeStandardRepo();
    const rNoRed = makeStandardRepo({ withRed: false });
    try {
      // 4. resolveProofBase
      const b1 = resolveProofBase(r.repoDir, "TX");
      expect(b1.ok).toBe(true);
      if (b1.ok) expect(b1.sha).toBe(r.redSha!);

      const b2 = resolveProofBase(rNoRed.repoDir, "TX");
      expect(b2.ok).toBe(false);
      if (!b2.ok) expect(b2.error).toContain("sem base");

      const b3 = resolveProofBase(r.repoDir, "TX", "nope");
      expect(b3.ok).toBe(false);
      if (!b3.ok) expect(b3.error).toContain("base inválida");

      // 5. withTempWorktree
      const tmpReal = realpathSync(tmpdir());
      let capturedWt = "";
      const resVal = withTempWorktree(r.repoDir, r.redSha!, (wtPath) => {
        capturedWt = wtPath;
        expect(existsSync(wtPath)).toBe(true);
        expect(wtPath.startsWith(join(tmpReal, WORKTREE_PREFIX))).toBe(true);
        const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
          cwd: wtPath,
          stdout: "pipe",
        })
          .stdout.toString()
          .trim();
        expect(head).toBe(r.redSha!);
        return 42;
      });
      expect(resVal).toBe(42);
      expect(existsSync(capturedWt)).toBe(false);
      const wtList = r.git("worktree", "list", "--porcelain");
      expect(wtList.includes("pinga-prove-")).toBe(false);

      // fn que lança Error("x") -> relança e limpa igual
      let thrownWt = "";
      expect(() =>
        withTempWorktree(r.repoDir, r.redSha!, (wtPath) => {
          thrownWt = wtPath;
          throw new Error("x");
        }),
      ).toThrow("x");
      expect(existsSync(thrownWt)).toBe(false);
      expect(r.git("worktree", "list", "--porcelain").includes("pinga-prove-")).toBe(
        false,
      );

      // 6. sweepStaleWorktrees
      const staleDir1 = mkdtempSync(join(tmpReal, WORKTREE_PREFIX));
      const staleWt1 = join(staleDir1, "wt");
      const otherDir = mkdtempSync(join(tmpReal, "outra-"));
      const otherWt = join(otherDir, "wt");
      const staleDir2 = mkdtempSync(join(tmpReal, WORKTREE_PREFIX));
      const staleWt2 = join(staleDir2, "wt");

      try {
        r.git("worktree", "add", "--detach", "-q", staleWt1, r.initSha);
        r.git("worktree", "add", "--detach", "-q", otherWt, r.initSha);
        r.git("worktree", "add", "--detach", "-q", staleWt2, r.initSha);
        // Apaga o diretório de staleDir2 à mão para testar prune
        rmSync(staleDir2, { recursive: true, force: true });

        const swept = sweepStaleWorktrees(r.repoDir);
        expect(swept).toContain(staleWt1);
        expect(existsSync(staleWt1)).toBe(false);
        expect(existsSync(otherWt)).toBe(true);

        const afterList = r.git("worktree", "list", "--porcelain");
        expect(afterList.includes(staleWt1)).toBe(false);
        expect(afterList.includes(staleWt2)).toBe(false);
        expect(afterList.includes(otherWt)).toBe(true);
      } finally {
        try {
          r.git("worktree", "remove", "--force", otherWt);
        } catch {}
        rmSync(staleDir1, { recursive: true, force: true });
        rmSync(otherDir, { recursive: true, force: true });
        rmSync(staleDir2, { recursive: true, force: true });
      }
    } finally {
      r.cleanup();
      rNoRed.cleanup();
    }
  });

  test("7–13. CLI prove-red: prova ok, árvore suja, RED tautológico, impl no base, inconclusivo, --base overlay e erros", () => {
    const printedReceipts: unknown[] = [];

    // 7 & 8. Prova ok em R e árvore suja no principal
    const r = makeStandardRepo();
    try {
      const p7 = r.runCli(["prove-red", r.planPath, "--ledger", r.ledgerPath]);
      expect(p7.exitCode).toBe(0);
      const rcpt7 = JSON.parse(p7.stdout.trim());
      printedReceipts.push(rcpt7);
      expect(rcpt7.flow).toBe("prove_red");
      expect(rcpt7.status).toBe("pass");
      expect(rcpt7.base_ref).toBe(r.redSha);
      expect(rcpt7.attempts).toBe(1);
      expect(rcpt7.evidence[0].exit).not.toBe(0);
      expect(existsSync(join(r.repoDir, "runs/TX/prove-1/out.txt"))).toBe(true);
      expect(r.git("worktree", "list", "--porcelain").includes("pinga-prove-")).toBe(
        false,
      );

      // 8. Árvore suja: src/a.ts -> 2 e src/b.ts untracked
      writeFileSync(join(r.repoDir, "src/a.ts"), "export const f = () => 2;\n");
      writeFileSync(join(r.repoDir, "src/b.ts"), "export const b = 1;\n");
      const statusBefore = r.git("status", "--porcelain");
      const p8 = r.runCli(["prove-red", r.planPath, "--ledger", r.ledgerPath]);
      expect(p8.exitCode).toBe(0);
      const rcpt8 = JSON.parse(p8.stdout.trim());
      printedReceipts.push(rcpt8);
      expect(rcpt8.attempts).toBe(2);
      expect(r.git("status", "--porcelain")).toBe(statusBefore);
      expect(readFileSync(join(r.repoDir, "src/a.ts"), "utf8")).toBe(
        "export const f = () => 2;\n",
      );

      // 12. --base <sha do chore: init> (overlay traz tests/a.test.ts da árvore de trabalho)
      const p12a = r.runCli([
        "prove-red",
        r.planPath,
        "--ledger",
        r.ledgerPath,
        "--base",
        r.initSha,
      ]);
      expect(p12a.exitCode).toBe(0);
      const rcpt12a = JSON.parse(p12a.stdout.trim());
      printedReceipts.push(rcpt12a);
      expect(rcpt12a.base_ref).toBe(r.initSha);

      // Com tests/a.test.ts também apagado da árvore de trabalho -> exit 8, 'teste ausente no base'
      rmSync(join(r.repoDir, "tests/a.test.ts"));
      const p12b = r.runCli([
        "prove-red",
        r.planPath,
        "--ledger",
        r.ledgerPath,
        "--base",
        r.initSha,
      ]);
      expect(p12b.exitCode).toBe(8);
      const rcpt12b = JSON.parse(p12b.stdout.trim());
      printedReceipts.push(rcpt12b);
      expect(rcpt12b.status).toBe("not run");
      expect(rcpt12b.reason_code).toBe("infra");
      expect(rcpt12b.summary).toContain("teste ausente no base");

      // 13. --base nope -> exit 2, sem recibo
      const p13a = r.runCli([
        "prove-red",
        r.planPath,
        "--ledger",
        r.ledgerPath,
        "--base",
        "nope",
      ]);
      expect(p13a.exitCode).toBe(2);
      expect(p13a.stderr).toContain("base inválida");

      const lv = r.runCli(["ledger", "verify", "--ledger", r.ledgerPath]);
      expect(lv.exitCode).toBe(0);
      expect(lv.stdout.trim()).toBe(`ok ${printedReceipts.length}`);
    } finally {
      r.cleanup();
    }

    // 9. RED tautológico -> exit 10, blocked/test_passed_on_base
    const rTaut = makeStandardRepo({
      redTestBody:
        'import { expect, test } from "bun:test";\ntest("taut", () => { expect(1).toBe(1); });\n',
    });
    try {
      const p9 = rTaut.runCli([
        "prove-red",
        rTaut.planPath,
        "--ledger",
        rTaut.ledgerPath,
      ]);
      expect(p9.exitCode).toBe(10);
      const rcpt9 = JSON.parse(p9.stdout.trim());
      expect(validateReceipt(rcpt9).ok).toBe(true);
      expect(rcpt9.status).toBe("blocked");
      expect(rcpt9.reason_code).toBe("test_passed_on_base");
      expect(rcpt9.summary).toContain("done_when passa no base");
      expect(rcpt9.next_action).toBe("reescrever o RED");
      expect(
        rTaut.git("worktree", "list", "--porcelain").includes("pinga-prove-"),
      ).toBe(false);
    } finally {
      rTaut.cleanup();
    }

    // 10. Implementação já no base -> exit 10
    const rImplBase = makeStandardRepo({
      baseFnBody: "export const f = () => 2;\n",
    });
    try {
      const p10 = rImplBase.runCli([
        "prove-red",
        rImplBase.planPath,
        "--ledger",
        rImplBase.ledgerPath,
      ]);
      expect(p10.exitCode).toBe(10);
    } finally {
      rImplBase.cleanup();
    }

    // 11. Inconclusivo (comando inexistente e timeout) + 13b (sem RED e sem --base)
    const rInc1 = makeStandardRepo({ doneWhen: "comando-inexistente-xyz" });
    const rInc2 = makeStandardRepo({ doneWhen: "sleep 5" });
    const rNoRed = makeStandardRepo({ withRed: false });
    try {
      const p11a = rInc1.runCli([
        "prove-red",
        rInc1.planPath,
        "--ledger",
        rInc1.ledgerPath,
      ]);
      expect(p11a.exitCode).toBe(8);
      const rcpt11a = JSON.parse(p11a.stdout.trim());
      expect(validateReceipt(rcpt11a).ok).toBe(true);
      expect(rcpt11a.status).toBe("not run");
      expect(rcpt11a.reason_code).toBe("infra");
      expect(
        rInc1.git("worktree", "list", "--porcelain").includes("pinga-prove-"),
      ).toBe(false);

      const p11b = rInc2.runCli(
        ["prove-red", rInc2.planPath, "--ledger", rInc2.ledgerPath],
        { PINGA_TIMEOUT_MS: "200" },
      );
      expect(p11b.exitCode).toBe(8);
      const rcpt11b = JSON.parse(p11b.stdout.trim());
      expect(validateReceipt(rcpt11b).ok).toBe(true);
      expect(rcpt11b.status).toBe("not run");
      expect(rcpt11b.reason_code).toBe("infra");
      expect(
        rInc2.git("worktree", "list", "--porcelain").includes("pinga-prove-"),
      ).toBe(false);

      const p13b = rNoRed.runCli([
        "prove-red",
        rNoRed.planPath,
        "--ledger",
        rNoRed.ledgerPath,
      ]);
      expect(p13b.exitCode).toBe(2);
      expect(p13b.stderr).toContain("sem base");
    } finally {
      rInc1.cleanup();
      rInc2.cleanup();
      rNoRed.cleanup();
    }
  });

  test("14. Holdout no base (fixture F5 da T10)", () => {
    const f5 = {
      target: { module: "src/double.ts", export: "double" },
      examples: [
        { input: [1], output: 2 },
        { input: [2], output: 4 },
        { input: [3], output: 6 },
        { input: [999001], output: 1998002 },
        { input: [999002], output: 1998004 },
      ],
    };
    const parsed = parseExamples(JSON.stringify(f5), "json");
    if (!parsed.ok) throw new Error("unexpected");
    const part = partitionExamples(parsed.spec, "TX");
    const holdoutEx = part.holdout[0]!;

    const makeHoldoutRepo = (baseDoubleCode: string) => {
      const env = makeStandardRepo({ withRed: false });
      const f5Path = join(env.extDir, "f5.json");
      writeFileSync(f5Path, JSON.stringify(f5));
      writeFileSync(
        env.planPath,
        [
          "---",
          "mode: padrao",
          'goal: "Implementar double"',
          'done_when: "bun test tests/examples/TX.test.ts"',
          'touch: ["src/double.ts"]',
          'tests_frozen: ["tests/examples/TX.test.ts"]',
          "---",
          "## Passos",
          "- [ ] 1",
          "## Dívidas conscientes",
          "- nenhuma",
          "## Fora",
          "- nada",
        ].join("\n"),
      );
      writeFileSync(join(env.repoDir, "src/double.ts"), baseDoubleCode);
      env.git("add", "tasks/TX/PLAN.md", "src/double.ts");
      env.git("commit", "-q", "--amend", "-m", "chore: init");

      const gen = env.runCli(["examples", env.planPath, "--from", f5Path]);
      expect(gen.exitCode).toBe(0);
      env.git("add", "tests/examples/TX.test.ts");
      env.git("commit", "-q", "-m", "test(TX): RED");
      return env;
    };

    // 14a: base com double = () => 0 -> visível e holdout falham -> exit 0, evidence.length === 2
    const env1 = makeHoldoutRepo("export const double = () => 0;\n");
    try {
      const p14a = env1.runCli([
        "prove-red",
        env1.planPath,
        "--ledger",
        env1.ledgerPath,
      ]);
      expect(p14a.exitCode).toBe(0);
      const rcpt14a = JSON.parse(p14a.stdout.trim());
      expect(validateReceipt(rcpt14a).ok).toBe(true);
      expect(rcpt14a.evidence.length).toBe(2);
    } finally {
      env1.cleanup();
    }

    // 14b: base com double que só acerta o exemplo do holdout -> visível falha, holdout passa -> exit 10
    const hIn = (holdoutEx.input as number[])[0];
    const hOut = holdoutEx.output as number;
    const env2 = makeHoldoutRepo(
      `export const double = (n: number) => (n === ${hIn} ? ${hOut} : -999);\n`,
    );
    try {
      const p14b = env2.runCli([
        "prove-red",
        env2.planPath,
        "--ledger",
        env2.ledgerPath,
      ]);
      expect(p14b.exitCode).toBe(10);
      const rcpt14b = JSON.parse(p14b.stdout.trim());
      expect(validateReceipt(rcpt14b).ok).toBe(true);
      expect(rcpt14b.status).toBe("blocked");
      expect(rcpt14b.reason_code).toBe("test_passed_on_base");
      expect(rcpt14b.summary).toContain("holdout passa no base");
    } finally {
      env2.cleanup();
    }
  });

  test("15. Limpeza depois de SIGKILL via sweepStaleWorktrees no prove-red seguinte", async () => {
    const r = makeStandardRepo({ doneWhen: "sleep 30" });
    try {
      const proc = Bun.spawn(
        ["bun", BIN, "prove-red", r.planPath, "--ledger", r.ledgerPath],
        {
          cwd: r.repoDir,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      let zombieWt: string | null = null;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const list = r.git("worktree", "list", "--porcelain");
        const match = list
          .split("\n")
          .find((l) => l.startsWith("worktree ") && l.includes("pinga-prove-"));
        if (match) {
          zombieWt = match.slice("worktree ".length).trim();
          break;
        }
        await Bun.sleep(40);
      }

      expect(zombieWt).not.toBeNull();
      proc.kill("SIGKILL");
      await proc.exited;

      // Agora restaura done_when normal e roda prove-red
      writeFileSync(
        r.planPath,
        readFileSync(r.planPath, "utf8").replace(
          '"sleep 30"',
          '"bun test tests/a.test.ts"',
        ),
      );
      const next = r.runCli([
        "prove-red",
        r.planPath,
        "--ledger",
        r.ledgerPath,
      ]);
      expect(next.exitCode).toBe(0);
      expect(existsSync(zombieWt!)).toBe(false);
      expect(r.git("worktree", "list", "--porcelain").includes("pinga-prove-")).toBe(
        false,
      );
    } finally {
      r.cleanup();
    }
  });

  test("16–22. Integração no verify (completo e --prove-base), consumidores (breaker + eval), CLI e ledger verify", () => {
    const printedReceipts: unknown[] = [];

    // 16. Plano com touch: ["src/a.ts", "src/auth/a.ts"] (vira completo) e RED tautológico -> verify exit 10
    const r16 = makeStandardRepo({
      touch: ["src/a.ts", "src/auth/a.ts"],
      redTestBody:
        'import { expect, test } from "bun:test";\ntest("taut", () => { expect(1).toBe(1); });\n',
    });
    try {
      const v16 = r16.runCli(["verify", r16.planPath, "--ledger", r16.ledgerPath]);
      expect(v16.exitCode).toBe(10);
      const rcpt16 = JSON.parse(v16.stdout.trim());
      printedReceipts.push(rcpt16);
      expect(rcpt16.status).toBe("blocked");
      expect(rcpt16.reason_code).toBe("test_passed_on_base");
      expect(rcpt16.mode_effective).toBe("completo");
      expect(rcpt16.base_ref).toBe(r16.redSha);
      expect(rcpt16.flow).toBeUndefined();
      expect(existsSync(join(r16.repoDir, "runs/TX/1/out.txt"))).toBe(false);
    } finally {
      r16.cleanup();
    }

    // 17. Mesmo plano (completo), RED válido, GREEN aplicado -> exit 0, pass, base_ref = sha do RED, flow: "awaiting_judge"
    const r17 = makeStandardRepo({
      touch: ["src/a.ts", "src/auth/a.ts"],
    });
    try {
      writeFileSync(join(r17.repoDir, "src/a.ts"), "export const f = () => 2;\n");
      r17.git("add", "src/a.ts");
      r17.git("commit", "-q", "-m", "feat(TX): GREEN");
      const v17 = r17.runCli(["verify", r17.planPath, "--ledger", r17.ledgerPath]);
      expect(v17.exitCode).toBe(0);
      const rcpt17 = JSON.parse(v17.stdout.trim());
      printedReceipts.push(rcpt17);
      expect(rcpt17.status).toBe("pass");
      expect(rcpt17.base_ref).toBe(r17.redSha);
      expect(rcpt17.flow).toBe("awaiting_judge");
    } finally {
      r17.cleanup();
    }

    // 18. Plano padrao sem sinais e RED tautológico: sem --prove-base -> exit 0, sem base_ref; com --prove-base -> exit 10
    const r18 = makeStandardRepo({
      redTestBody:
        'import { expect, test } from "bun:test";\ntest("taut", () => { expect(1).toBe(1); });\n',
    });
    try {
      const v18a = r18.runCli(["verify", r18.planPath, "--ledger", r18.ledgerPath]);
      expect(v18a.exitCode).toBe(0);
      const rcpt18a = JSON.parse(v18a.stdout.trim());
      printedReceipts.push(rcpt18a);
      expect(rcpt18a.base_ref).toBeUndefined();

      const v18b = r18.runCli([
        "verify",
        r18.planPath,
        "--ledger",
        r18.ledgerPath,
        "--prove-base",
      ]);
      expect(v18b.exitCode).toBe(10);
      const rcpt18b = JSON.parse(v18b.stdout.trim());
      printedReceipts.push(rcpt18b);
      expect(rcpt18b.reason_code).toBe("test_passed_on_base");
    } finally {
      r18.cleanup();
    }

    // 19. Plano completo sem commit RED -> stderr contém 'prova no base pulada', exit 0
    const r19 = makeStandardRepo({
      withRed: false,
      touch: ["src/a.ts", "src/auth/a.ts"],
      doneWhen: "true",
    });
    try {
      const v19 = r19.runCli(["verify", r19.planPath, "--ledger", r19.ledgerPath]);
      expect(v19.exitCode).toBe(0);
      expect(v19.stderr).toContain("prova no base pulada");
      const rcpt19 = JSON.parse(v19.stdout.trim());
      printedReceipts.push(rcpt19);
      expect(rcpt19.status).toBe("pass");
      expect(rcpt19.flow).toBe("awaiting_judge");
    } finally {
      r19.cleanup();
    }

    // 20. Consumidores: verify (exit 1) -> prove-red (exit 0) -> verify (exit 4 disjuntor) + eval
    const r20 = makeStandardRepo({ doneWhen: "exit 7" });
    try {
      const v20a = r20.runCli(["verify", r20.planPath, "--ledger", r20.ledgerPath]);
      expect(v20a.exitCode).toBe(1);
      printedReceipts.push(JSON.parse(v20a.stdout.trim()));

      const pr20 = r20.runCli([
        "prove-red",
        r20.planPath,
        "--ledger",
        r20.ledgerPath,
      ]);
      expect(pr20.exitCode).toBe(0);
      printedReceipts.push(JSON.parse(pr20.stdout.trim()));

      const v20b = r20.runCli(["verify", r20.planPath, "--ledger", r20.ledgerPath]);
      expect(v20b.exitCode).toBe(4);
      printedReceipts.push(JSON.parse(v20b.stdout.trim()));

      const lv20 = r20.runCli(["ledger", "verify", "--ledger", r20.ledgerPath]);
      expect(lv20.exitCode).toBe(0);
      expect(lv20.stdout.trim()).toBe("ok 3");
    } finally {
      r20.cleanup();
    }

    // eval depois de prove-red + verify pass -> tentativas 1
    const r20Eval = makeStandardRepo();
    try {
      writeFileSync(join(r20Eval.repoDir, "src/a.ts"), "export const f = () => 2;\n");
      r20Eval.git("add", "src/a.ts");
      r20Eval.git("commit", "-q", "-m", "feat(TX): GREEN");

      const pr = r20Eval.runCli([
        "prove-red",
        r20Eval.planPath,
        "--ledger",
        r20Eval.ledgerPath,
      ]);
      expect(pr.exitCode).toBe(0);

      const vp = r20Eval.runCli([
        "verify",
        r20Eval.planPath,
        "--ledger",
        r20Eval.ledgerPath,
      ]);
      expect(vp.exitCode).toBe(0);

      const ev = r20Eval.runCli([
        "eval",
        r20Eval.planPath,
        "--ledger",
        r20Eval.ledgerPath,
      ]);
      expect(ev.exitCode).toBe(0);
      const evalContent = readFileSync(
        join(r20Eval.repoDir, "tasks/TX/EVAL.md"),
        "utf8",
      );
      expect(evalContent).toContain("tentativas 1");
    } finally {
      r20Eval.cleanup();
    }

    // 21. CLI: prove-red sem plano -> exit 2; --base sem valor -> exit 2; --xpto -> exit 2
    const r21 = makeStandardRepo();
    try {
      expect(r21.runCli(["prove-red"]).exitCode).toBe(2);
      expect(r21.runCli(["prove-red", r21.planPath, "--base"]).exitCode).toBe(2);
      expect(r21.runCli(["prove-red", r21.planPath, "--xpto"]).exitCode).toBe(2);
    } finally {
      r21.cleanup();
    }

    // 22. Todos os recibos coletados passam no validateReceipt
    for (const rcpt of printedReceipts) {
      expect(validateReceipt(rcpt).ok).toBe(true);
    }
  });
});
