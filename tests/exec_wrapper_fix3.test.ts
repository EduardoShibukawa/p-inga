import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// T75 (PLAN-0018, judge Codex rodada 3): (1) prove no exit 97 grava blocked
// (não "not run"); (2) holdout do verify com exit 97 vira blocked/infra
// (não overfit_holdout/fail).
const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");
const src = (f: string) => readFileSync(join(ROOT, "src", f), "utf8");

function makeRepo() {
  const base = mkdtempSync(join(tmpdir(), "pinga-fix3-"));
  const repo = join(base, "repo");
  mkdirSync(repo, { recursive: true });
  const git = (...a: string[]) => {
    const r = Bun.spawnSync(["git", ...a], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString()}`);
    return r.stdout.toString().trim();
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "T");
  git("config", "user.email", "t@e.c");
  mkdirSync(join(repo, "tasks", "TX"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  const plan = join(repo, "tasks", "TX", "PLAN.md");
  writeFileSync(plan, ["---", "mode: mvp", 'goal: "f() === 2"', 'done_when: "bun test tests/a.test.ts"', 'touch: ["src/a.ts"]', 'tests_frozen: ["tests/a.test.ts"]', "---", "c", ""].join("\n"));
  writeFileSync(join(repo, "src", "a.ts"), "export const f = () => 1;\n");
  git("add", "tasks/TX/PLAN.md", "src/a.ts");
  git("commit", "-q", "-m", "chore: init");
  mkdirSync(join(repo, "tests"), { recursive: true });
  writeFileSync(join(repo, "tests", "a.test.ts"), 'import { expect, test } from "bun:test";\nimport { f } from "../src/a";\ntest("f() === 2", () => { expect(f()).toBe(2); });\n');
  git("add", "tests/a.test.ts");
  git("commit", "-q", "-m", "test(TX): RED");
  const wrap = join(base, "wrap97.sh");
  writeFileSync(wrap, "#!/bin/sh\nexit 97\n");
  chmodSync(wrap, 0o755);
  const run = (args: string[]) => {
    const r = Bun.spawnSync(["bun", BIN, ...args], { cwd: repo, env: { ...process.env, PINGA_EXEC_WRAPPER: wrap }, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  };
  return { base, repo, plan, run, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

describe("prove: exit 97 grava blocked, não not run", () => {
  let r: ReturnType<typeof makeRepo>;
  beforeEach(() => { r = makeRepo(); });
  afterEach(() => r.cleanup());
  test("prove-red com wrapper 97 → receipt blocked/infra", () => {
    const res = r.run(["prove-red", join(r.repo, "tasks", "TX", "PLAN.md"), "--ledger", join(r.base, "l.db")]);
    const line = res.out.split("\n").find((l) => l.includes('"type":"task.receipt"')) ?? "";
    expect(line).toContain('"status":"blocked"');
    expect(line).toContain('"reason_code":"infra"');
    expect(line).not.toContain('"status":"not run"');
  });
});

describe("verify: holdout com exit 97 vira blocked/infra", () => {
  test("código trata WRAPPER_UNAVAILABLE_EXIT no ramo do holdout", () => {
    const s = src("verify.ts");
    expect(s.includes("WRAPPER_UNAVAILABLE_EXIT")).toBe(true);
    // o ramo do holdout (hRun) precisa reconhecer o exit 97 e selar infra,
    // não cair em overfit_holdout.
    expect(/hRun[\s\S]{0,600}WRAPPER_UNAVAILABLE_EXIT|WRAPPER_UNAVAILABLE_EXIT[\s\S]{0,600}hRun/.test(s)).toBe(true);
  });
});
