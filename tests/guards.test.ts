import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GUARD_EXIT,
  alwaysAllowed,
  changedFiles,
  evaluateGuards,
  findRedBase,
  precommitDecision,
} from "../src/guards";
import { openLedger } from "../src/ledger";
import { validateReceipt } from "../src/receipt";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

function git(cwd: string, args: string[]) {
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.toString()}`);
  }
  return res.stdout.toString().trim();
}

function makeGuardFixture(task = "TX", withRedCommit = true) {
  const repoDir = mkdtempSync(join(tmpdir(), "pinga-guards-repo-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-guards-ledger-"));
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
    'goal: "Test guards"',
    'done_when: "touch ran.flag"',
    'touch: ["src/a.ts"]',
    'tests_frozen: ["tests/a.test.ts"]',
    "budget: { tokens: 100000, minutes: 5 }",
    "---",
    "## Passos",
    "- [ ] step",
  ].join("\n");

  writeFileSync(planPath, `${planContent}\n`);
  writeFileSync(join(repoDir, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(repoDir, "src/d.ts"), "export const d = 4;\n");
  writeFileSync(join(repoDir, "tests/a.test.ts"), "// initial test\n");
  writeFileSync(
    join(repoDir, ".gitignore"),
    ["runs/", ".pinga/", "*.db", "ran.flag"].join("\n") + "\n",
  );

  git(repoDir, [
    "add",
    `tasks/${task}/PLAN.md`,
    "src/a.ts",
    "src/d.ts",
    "tests/a.test.ts",
    ".gitignore",
  ]);
  git(repoDir, ["commit", "-m", "chore: init"]);

  let redSha: string | null = null;
  if (withRedCommit) {
    writeFileSync(join(repoDir, "tests/a.test.ts"), "// RED test\n");
    git(repoDir, ["add", "tests/a.test.ts"]);
    git(repoDir, ["commit", "-m", `test(${task}): RED initial cases`]);
    redSha = git(repoDir, ["rev-parse", "HEAD"]);
  }

  return {
    repoDir,
    planPath,
    ledgerPath,
    redSha,
    cleanup: () => {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

describe("T04 — Guards (tests_frozen_changed & scope_drift) and precommit", () => {
  test("1. evaluateGuards returns { ok: true } when changed files are within touch and not in tests_frozen", () => {
    expect(GUARD_EXIT).toEqual({ tests_frozen_changed: 5, scope_drift: 6 });
    const res = evaluateGuards({
      task: "TX",
      touch: ["src/a.ts"],
      tests_frozen: ["tests/a.test.ts"],
      changed: ["src/a.ts"],
    });
    expect(res).toEqual({ ok: true });
  });

  test("2. evaluateGuards returns tests_frozen_changed (exit 5) when a frozen test is changed", () => {
    const res = evaluateGuards({
      task: "TX",
      touch: ["src/a.ts"],
      tests_frozen: ["tests/a.test.ts"],
      changed: ["tests/a.test.ts", "src/a.ts"],
    });
    expect(res).toEqual({
      ok: false,
      reason_code: "tests_frozen_changed",
      files: ["tests/a.test.ts"],
      exit: 5,
    });
  });

  test("3. evaluateGuards returns scope_drift (exit 6) with sorted out-of-touch files", () => {
    const res = evaluateGuards({
      task: "TX",
      touch: ["src/a.ts"],
      tests_frozen: ["tests/a.test.ts"],
      changed: ["src/b.ts", "src/a.ts", "README.md"],
    });
    expect(res).toEqual({
      ok: false,
      reason_code: "scope_drift",
      files: ["README.md", "src/b.ts"],
      exit: 6,
    });
  });

  test("4. evaluateGuards gives precedence to tests_frozen_changed over scope_drift", () => {
    const res = evaluateGuards({
      task: "TX",
      touch: ["src/a.ts"],
      tests_frozen: ["tests/a.test.ts"],
      changed: ["tests/a.test.ts", "src/b.ts"],
    });
    expect(res).toEqual({
      ok: false,
      reason_code: "tests_frozen_changed",
      files: ["tests/a.test.ts"],
      exit: 5,
    });
  });

  test("5. evaluateGuards allows EXEC.md and EVAL.md of the same task, but rejects other task's EVAL.md or same task's PLAN.md", () => {
    expect(
      evaluateGuards({
        task: "TX",
        touch: ["src/a.ts"],
        tests_frozen: ["tests/a.test.ts"],
        changed: ["tasks/TX/EXEC.md", "tasks/TX/EVAL.md"],
      }),
    ).toEqual({ ok: true });

    expect(
      evaluateGuards({
        task: "TX",
        touch: ["src/a.ts"],
        tests_frozen: ["tests/a.test.ts"],
        changed: ["tasks/TY/EVAL.md"],
      }),
    ).toEqual({
      ok: false,
      reason_code: "scope_drift",
      files: ["tasks/TY/EVAL.md"],
      exit: 6,
    });

    expect(
      evaluateGuards({
        task: "TX",
        touch: ["src/a.ts"],
        tests_frozen: ["tests/a.test.ts"],
        changed: ["tasks/TX/PLAN.md"],
      }),
    ).toEqual({
      ok: false,
      reason_code: "scope_drift",
      files: ["tasks/TX/PLAN.md"],
      exit: 6,
    });
  });

  test("6. evaluateGuards without touch and without tests_frozen allows any changed files", () => {
    expect(
      evaluateGuards({
        task: "TX",
        changed: ["anything.ts", "tests/a.test.ts"],
      }),
    ).toEqual({ ok: true });
  });

  test("7. alwaysAllowed('T04') returns ['tasks/T04/EXEC.md', 'tasks/T04/EVAL.md']", () => {
    expect(alwaysAllowed("T04")).toEqual(["tasks/T04/EXEC.md", "tasks/T04/EVAL.md"]);
  });

  test("8. precommitDecision returns 'skip' only when non-empty and all paths start with tests/, tasks/ or specs/", () => {
    expect(precommitDecision(["tests/a.test.ts"])).toBe("skip");
    expect(precommitDecision(["tasks/T04/EXEC.md", "tasks/T04/EVAL.md"])).toBe("skip");
    expect(precommitDecision(["specs/x.md"])).toBe("skip");
    expect(precommitDecision(["src/a.ts", "tests/a.test.ts"])).toBe("test");
    expect(precommitDecision([])).toBe("test");
  });

  test("9. findRedBase finds most recent exact test(<task>): RED commit, returns null if missing or no commits", () => {
    const emptyRepo = mkdtempSync(join(tmpdir(), "pinga-empty-git-"));
    try {
      git(emptyRepo, ["init", "-q", "-b", "main"]);
      expect(findRedBase(emptyRepo, "TX")).toBeNull();
    } finally {
      rmSync(emptyRepo, { recursive: true, force: true });
    }

    const { repoDir, cleanup } = makeGuardFixture("TX", false);
    try {
      writeFileSync(join(repoDir, "tests/a.test.ts"), "// RED a\n");
      git(repoDir, ["add", "tests/a.test.ts"]);
      git(repoDir, ["commit", "-m", "test(TX): RED a"]);

      writeFileSync(join(repoDir, "src/a.ts"), "export const a = 2;\n");
      git(repoDir, ["add", "src/a.ts"]);
      git(repoDir, ["commit", "-m", "feat(TX): x"]);

      writeFileSync(join(repoDir, "tests/a.test.ts"), "// RED b\n");
      git(repoDir, ["add", "tests/a.test.ts"]);
      git(repoDir, ["commit", "-m", "test(TX): RED b"]);
      const shaRedB = git(repoDir, ["rev-parse", "HEAD"]);

      writeFileSync(join(repoDir, "tests/a.test.ts"), "// RED c for TX1\n");
      git(repoDir, ["add", "tests/a.test.ts"]);
      git(repoDir, ["commit", "-m", "test(TX1): RED c"]);

      expect(findRedBase(repoDir, "TX")).toBe(shaRedB);
      expect(findRedBase(repoDir, "TZ")).toBeNull();
    } finally {
      cleanup();
    }
  });

  test("10. changedFiles returns sorted unique union of committed, unstaged, deleted, and non-ignored untracked files since base", () => {
    const { repoDir, redSha, cleanup } = makeGuardFixture("TX", true);
    try {
      writeFileSync(join(repoDir, "src/c.ts"), "export const c = 3;\n");
      git(repoDir, ["add", "src/c.ts"]);
      git(repoDir, ["commit", "-m", "chore: add c"]);
      const base = git(repoDir, ["rev-parse", "HEAD"]);

      // Commit modifying src/a.ts
      writeFileSync(join(repoDir, "src/a.ts"), "export const a = 2;\n");
      git(repoDir, ["add", "src/a.ts"]);
      git(repoDir, ["commit", "-m", "feat(TX): update a"]);

      // Uncommitted modification to src/c.ts
      writeFileSync(join(repoDir, "src/c.ts"), "export const c = 33;\n");

      // Deleted src/d.ts
      unlinkSync(join(repoDir, "src/d.ts"));

      // Untracked new.txt and ignored x.db
      writeFileSync(join(repoDir, "new.txt"), "hello\n");
      writeFileSync(join(repoDir, "x.db"), "sqlite-bytes\n");

      expect(redSha).not.toBeNull();
      expect(changedFiles(repoDir, base)).toEqual(["new.txt", "src/a.ts", "src/c.ts", "src/d.ts"]);
    } finally {
      cleanup();
    }
  });

  test("11. CLI guards ok: after RED, modifying and committing only src/a.ts -> exit 0, pass, ran.flag exists", () => {
    const { repoDir, planPath, ledgerPath, cleanup } = makeGuardFixture("TX", true);
    try {
      writeFileSync(join(repoDir, "src/a.ts"), "export const a = 2;\n");
      git(repoDir, ["add", "src/a.ts"]);
      git(repoDir, ["commit", "-m", "feat(TX): green"]);

      const res = Bun.spawnSync(["bun", BIN, "verify", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
      });
      expect(res.exitCode).toBe(0);
      const rcpt = JSON.parse(res.stdout.toString().trim());
      expect(rcpt.status).toBe("pass");
      expect(existsSync(join(repoDir, "ran.flag"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("12. CLI tests_frozen changed: modifying tests/a.test.ts after RED -> exit 5, blocked/tests_frozen_changed, done_when does NOT run", () => {
    const { repoDir, planPath, ledgerPath, cleanup } = makeGuardFixture("TX", true);
    try {
      writeFileSync(join(repoDir, "tests/a.test.ts"), "// tampered test\n");

      const res = Bun.spawnSync(["bun", BIN, "verify", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
      });
      expect(res.exitCode).toBe(5);
      const rcpt = JSON.parse(res.stdout.toString().trim());
      expect(rcpt.status).toBe("blocked");
      expect(rcpt.reason_code).toBe("tests_frozen_changed");
      expect(rcpt.evidence).toEqual([]);
      expect(rcpt.summary).toContain("tests/a.test.ts");
      expect(existsSync(join(repoDir, "ran.flag"))).toBe(false);
      expect(existsSync(join(repoDir, "runs/TX/1/out.txt"))).toBe(false);
      expect(validateReceipt(rcpt).ok).toBe(true);

      const ledger = openLedger(ledgerPath);
      expect(ledger.all().length).toBe(1);
      ledger.close();
    } finally {
      cleanup();
    }
  });

  test("13. CLI scope_drift: creating untracked src/extra.ts after RED -> exit 6, blocked/scope_drift, done_when does NOT run", () => {
    const { repoDir, planPath, ledgerPath, cleanup } = makeGuardFixture("TX", true);
    try {
      writeFileSync(join(repoDir, "src/extra.ts"), "export const extra = 1;\n");

      const res = Bun.spawnSync(["bun", BIN, "verify", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
      });
      expect(res.exitCode).toBe(6);
      const rcpt = JSON.parse(res.stdout.toString().trim());
      expect(rcpt.status).toBe("blocked");
      expect(rcpt.reason_code).toBe("scope_drift");
      expect(rcpt.evidence).toEqual([]);
      expect(rcpt.summary).toContain("src/extra.ts");
      expect(existsSync(join(repoDir, "ran.flag"))).toBe(false);
      expect(validateReceipt(rcpt).ok).toBe(true);
    } finally {
      cleanup();
    }
  });

  test("14. CLI alwaysAllowed: creating and committing tasks/TX/EXEC.md and tasks/TX/EVAL.md after RED -> exit 0, pass", () => {
    const { repoDir, planPath, ledgerPath, cleanup } = makeGuardFixture("TX", true);
    try {
      writeFileSync(join(repoDir, "tasks/TX/EXEC.md"), "exec\n");
      writeFileSync(join(repoDir, "tasks/TX/EVAL.md"), "eval\n");
      git(repoDir, ["add", "tasks/TX/EXEC.md", "tasks/TX/EVAL.md"]);
      git(repoDir, ["commit", "-m", "docs(TX): EVAL e EXEC"]);

      const res = Bun.spawnSync(["bun", BIN, "verify", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
      });
      expect(res.exitCode).toBe(0);
      const rcpt = JSON.parse(res.stdout.toString().trim());
      expect(rcpt.status).toBe("pass");
    } finally {
      cleanup();
    }
  });

  test("15 & 17. CLI --base flag: custom base SHA, invalid base SHA (exit 2, no receipt), missing value (exit 2), ledger verify ok", () => {
    const { repoDir, planPath, ledgerPath, redSha, cleanup } = makeGuardFixture("TX", true);
    try {
      const firstRed = redSha!;
      // Commit src/b.ts (out of touch) between first RED and second RED
      writeFileSync(join(repoDir, "src/b.ts"), "export const b = 2;\n");
      git(repoDir, ["add", "src/b.ts"]);
      git(repoDir, ["commit", "-m", "chore: add b"]);

      writeFileSync(join(repoDir, "tests/a.test.ts"), "// second RED\n");
      git(repoDir, ["add", "tests/a.test.ts"]);
      git(repoDir, ["commit", "-m", "test(TX): RED second"]);

      // Without --base, uses second RED -> exit 0
      const rOk = Bun.spawnSync(["bun", BIN, "verify", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
      });
      expect(rOk.exitCode).toBe(0);

      // With --base <firstRed>, sees tests/a.test.ts & src/b.ts changed -> exit 5 (or 6 if only src/b.ts)
      // Wait: case 15 says: "dois commits RED de TX, com src/b.ts commitado entre eles; --base <sha do 1º RED> -> exit 6"
      // Let's make sure the 2nd RED commit didn't touch tests/a.test.ts, or touched something allowed so --base 1st RED gives exit 6!
    } finally {
      cleanup();
    }

    // Dedicated clean check for Case 15 exact scenario:
    const f2 = makeGuardFixture("TX", true);
    try {
      const sha1 = f2.redSha!;
      writeFileSync(join(f2.repoDir, "src/b.ts"), "export const b = 2;\n");
      git(f2.repoDir, ["add", "src/b.ts"]);
      git(f2.repoDir, ["commit", "-m", "chore: b"]);

      // Second RED commit touches only src/a.ts (or --allow-empty) so tests/a.test.ts is not changed after sha1
      git(f2.repoDir, ["commit", "--allow-empty", "-m", "test(TX): RED second"]);

      const r1 = Bun.spawnSync(["bun", BIN, "verify", f2.planPath, "--ledger", f2.ledgerPath], {
        cwd: ROOT,
      });
      expect(r1.exitCode).toBe(0);
      expect(validateReceipt(JSON.parse(r1.stdout.toString().trim())).ok).toBe(true);

      const r2 = Bun.spawnSync(
        ["bun", BIN, "verify", f2.planPath, "--ledger", f2.ledgerPath, "--base", sha1],
        { cwd: ROOT },
      );
      expect(r2.exitCode).toBe(6);
      expect(validateReceipt(JSON.parse(r2.stdout.toString().trim())).ok).toBe(true);

      const ledgerBefore = openLedger(f2.ledgerPath);
      const countBefore = ledgerBefore.all().length;
      ledgerBefore.close();

      const rBad = Bun.spawnSync(
        ["bun", BIN, "verify", f2.planPath, "--ledger", f2.ledgerPath, "--base", "nope"],
        { cwd: ROOT },
      );
      expect(rBad.exitCode).toBe(2);
      expect(rBad.stderr.toString()).toContain("base inválida");

      const ledgerAfter = openLedger(f2.ledgerPath);
      expect(ledgerAfter.all().length).toBe(countBefore);
      expect(ledgerAfter.verify()).toEqual({ ok: true, count: countBefore });
      ledgerAfter.close();

      const rNoVal = Bun.spawnSync(
        ["bun", BIN, "verify", f2.planPath, "--ledger", f2.ledgerPath, "--base"],
        { cwd: ROOT },
      );
      expect(rNoVal.exitCode).toBe(2);
    } finally {
      f2.cleanup();
    }
  });

  test("16. CLI without RED commit (only chore: init + untracked src/b.ts) -> guards skipped, exit 0, pass", () => {
    const { repoDir, planPath, ledgerPath, cleanup } = makeGuardFixture("TX", false);
    try {
      writeFileSync(join(repoDir, "src/b.ts"), "export const b = 1;\n");
      const res = Bun.spawnSync(["bun", BIN, "verify", planPath, "--ledger", ledgerPath], {
        cwd: ROOT,
      });
      expect(res.exitCode).toBe(0);
      const rcpt = JSON.parse(res.stdout.toString().trim());
      expect(rcpt.status).toBe("pass");
    } finally {
      cleanup();
    }
  });

  test("18. root mise.toml has pkl = '0.32.1' in [tools] and pre-commit runs 'pinga.ts precommit' and 'bun test'", () => {
    const raw = readFileSync(join(ROOT, "mise.toml"), "utf8");
    expect(raw).toMatch(/^\s*pkl\s*=\s*"0\.32\.1"\s*$/m);
    const preCommitSection = raw.split("[tasks.pre-commit]")[1] ?? "";
    expect(preCommitSection).toContain("pinga.ts precommit");
    expect(preCommitSection).toContain("bun test");
  });

  test("19. CLI 'pinga precommit': skips when only tests/ staged, runs command when src/ staged", () => {
    const { repoDir, cleanup } = makeGuardFixture("TX", false);
    try {
      writeFileSync(join(repoDir, "tests/a.test.ts"), "// staged test only\n");
      git(repoDir, ["add", "tests/a.test.ts"]);

      const rSkip = Bun.spawnSync(["bun", BIN, "precommit", "--", "false"], { cwd: repoDir });
      expect(rSkip.exitCode).toBe(0);
      expect(rSkip.stdout.toString()).toContain("suíte pulada");

      writeFileSync(join(repoDir, "src/a.ts"), "export const a = 99;\n");
      git(repoDir, ["add", "src/a.ts"]);

      const rFail = Bun.spawnSync(["bun", BIN, "precommit", "--", "false"], { cwd: repoDir });
      expect(rFail.exitCode).toBe(1);

      const rPass = Bun.spawnSync(["bun", BIN, "precommit", "--", "true"], { cwd: repoDir });
      expect(rPass.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });
});
