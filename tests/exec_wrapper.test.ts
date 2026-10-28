import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// T71 (PLAN-0018, INTENT-0006 opção A): o done_when roda via $PINGA_EXEC_WRAPPER (ex.: bwrap),
// fail-closed: wrapper configurado mas inutilizável nunca cai para execução nua.
const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");
type Exec = { doneWhenArgv: (cmd: string, root: string, env?: Record<string, string | undefined>) => string[] };
const load = async () => (await import(join(ROOT, "src/exec.ts"))) as Exec;

describe("doneWhenArgv", () => {
  test("sem wrapper: sh -c <cmd>", async () => {
    expect((await load()).doneWhenArgv("echo hi", "/r", {})).toEqual(["sh", "-c", "echo hi"]);
    expect((await load()).doneWhenArgv("echo hi", "/r", { PINGA_EXEC_WRAPPER: "" })).toEqual(["sh", "-c", "echo hi"]);
  });
  test("com wrapper: <wrapper> <root> sh -c <cmd>", async () => {
    expect((await load()).doneWhenArgv("echo hi", "/r", { PINGA_EXEC_WRAPPER: "/w/sb" })).toEqual(["/w/sb", "/r", "sh", "-c", "echo hi"]);
  });
});

describe("todo done_when passa por src/exec.ts", () => {
  test("nenhum spawn de `sh -c` com done_when fora de exec.ts", () => {
    for (const f of ["verify.ts", "prove.ts", "plan_verify.ts", "supersede.ts"]) {
      const src = readFileSync(join(ROOT, "src", f), "utf8");
      expect({ f, nua: /spawnSync\(\s*\[\s*"sh",\s*"-c",\s*\w+\.done_when/.test(src) }).toEqual({ f, nua: false });
      expect({ f, usa: src.includes("doneWhenArgv(") }).toEqual({ f, usa: true });
    }
  });
});

describe("pinga verify com PINGA_EXEC_WRAPPER", () => {
  let repo: string;
  let plan: string;
  let ledger: string;
  let wrap: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "pinga-exec-"));
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo });
    mkdirSync(join(repo, "tasks", "TW"), { recursive: true });
    plan = join(repo, "tasks", "TW", "PLAN.md");
    ledger = join(repo, ".pinga", "ledger.db");
    writeFileSync(plan, ["---", "mode: mvp", 'goal: "wrapper"', 'done_when: "touch ran.txt"', 'touch: ["ran.txt"]', "---", "corpo", ""].join("\n"));
    wrap = join(repo, "..", `wrap-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); rmSync(wrap, { force: true }); });
  const verify = (env: Record<string, string>) =>
    Bun.spawnSync(["bun", BIN, "verify", plan, "--ledger", ledger, "--no-baseline"], { cwd: ROOT, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });

  test("o wrapper recebe a raiz do repo e executa o comando", () => {
    writeFileSync(wrap, `#!/bin/sh\necho "$1" > "$1/wrapped.txt"\nshift\nexec "$@"\n`);
    chmodSync(wrap, 0o755);
    const r = verify({ PINGA_EXEC_WRAPPER: wrap });
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(repo, "ran.txt"))).toBe(true);
    expect(readFileSync(join(repo, "wrapped.txt"), "utf8").trim()).toBe(repo);
  });

  test("wrapper inexistente: fail-closed, não executa o done_when", () => {
    const r = verify({ PINGA_EXEC_WRAPPER: join(repo, "nao-existe.sh") });
    expect(r.exitCode).not.toBe(0);
    expect(existsSync(join(repo, "ran.txt"))).toBe(false);
    expect(r.stdout.toString() + r.stderr.toString()).toContain("PINGA_EXEC_WRAPPER");
  });

  test("wrapper sai 97 (sandbox indisponível): receipt blocked/infra, nunca pass nem fail", () => {
    writeFileSync(wrap, "#!/bin/sh\nexit 97\n");
    chmodSync(wrap, 0o755);
    const r = verify({ PINGA_EXEC_WRAPPER: wrap });
    expect(r.exitCode).not.toBe(0);
    const out = r.stdout.toString();
    const line = out.split("\n").find((l) => l.includes('"type":"task.receipt"')) ?? "";
    expect(line).toContain('"status":"blocked"');
    expect(line).toContain('"reason_code":"infra"');
  });
});
