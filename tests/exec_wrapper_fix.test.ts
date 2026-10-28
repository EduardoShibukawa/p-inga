import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// T72 (PLAN-0018, judge Codex): holdout também passa pelo wrapper; todos os caminhos são fail-closed;
// no prove, exit 97 (sandbox indisponível) vira infra e o holdout não sobrepõe.
const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");
const src = (f: string) => readFileSync(join(ROOT, "src", f), "utf8");

describe("holdout pelo wrapper", () => {
  test("runHoldout monta o argv via doneWhenArgv, sem spawn nu de bun test", () => {
    const s = src("examples.ts");
    expect(s.includes("doneWhenArgv(")).toBe(true);
    expect(/spawnSync\(\s*\[\s*"bun",\s*"test"/.test(s)).toBe(false);
  });
});

describe("fail-closed em todos os caminhos", () => {
  for (const f of ["prove.ts", "plan_verify.ts", "supersede.ts", "verify.ts"]) {
    test(`${f} checa wrapperProblem antes de executar`, () => {
      expect(src(f).includes("wrapperProblem(")).toBe(true);
    });
  }
  test("prove: exit 97 é infra com precedência sobre o veredito do holdout", () => {
    const s = src("prove.ts");
    expect(s.includes("WRAPPER_UNAVAILABLE_EXIT")).toBe(true);
    expect(/holdout[\s\S]{0,400}WRAPPER_UNAVAILABLE_EXIT|WRAPPER_UNAVAILABLE_EXIT[\s\S]{0,400}holdout/i.test(s)).toBe(true);
  });
});

describe("pinga supersede com wrapper inexistente", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "pinga-exec-fix-"));
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo });
    mkdirSync(join(repo, "tasks", "TS"), { recursive: true });
    writeFileSync(join(repo, "tasks", "TS", "PLAN.md"), ["---", "mode: mvp", 'goal: "s"', 'done_when: "touch ran.txt"', 'touch: ["ran.txt"]', "---", "c", ""].join("\n"));
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));
  test("não executa o done_when e sai != 0 citando PINGA_EXEC_WRAPPER", () => {
    const r = Bun.spawnSync(["bun", BIN, "supersede", join(repo, "tasks", "TS", "PLAN.md"), "--reason", "teste", "--ledger", join(repo, ".pinga", "l.db")], {
      cwd: repo, env: { ...process.env, PINGA_EXEC_WRAPPER: join(repo, "nao-existe.sh") }, stdout: "pipe", stderr: "pipe",
    });
    expect(r.exitCode).not.toBe(0);
    expect(existsSync(join(repo, "ran.txt"))).toBe(false);
    expect(r.stdout.toString() + r.stderr.toString()).toContain("PINGA_EXEC_WRAPPER");
  });
});
