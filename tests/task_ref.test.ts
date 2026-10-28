import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

async function loadRef(): Promise<{ taskRef: (p: string) => string } | null> {
  try {
    return (await import(join(ROOT, "src/task_ref.ts"))) as { taskRef: (p: string) => string };
  } catch {
    return null;
  }
}

let ws: string;
let ledger: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "pinga-taskref-"));
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: ws });
  ledger = join(ws, ".pinga", "ledger.db");
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

function put(rel: string, text: string): string {
  const p = join(ws, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

const TASK = (doneWhen = "true") =>
  [
    "---",
    "type: task",
    "mode: mvp",
    'goal: "g"',
    "plan: PLAN-0005-x",
    "tier: free",
    `done_when: ${JSON.stringify(doneWhen)}`,
    'tests_frozen: ["tests/x.test.ts"]',
    "---",
    "corpo",
  ].join("\n") + "\n";

function run(args: string[]) {
  const r = Bun.spawnSync(["bun", BIN, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const lines = r.stdout.toString().trim().split("\n").filter(Boolean);
  let receipt: Record<string, any> | null = null;
  try {
    receipt = JSON.parse(lines[lines.length - 1] ?? "");
  } catch {}
  return { code: r.exitCode, receipt, err: r.stderr.toString() };
}

describe("taskRef", () => {
  test("legado tasks/T<N>/PLAN.md devolve T<N>; pasta que não é T<N> continua devolvendo o nome", async () => {
    const m = await loadRef();
    expect(m).not.toBeNull();
    expect(m!.taskRef("/r/tasks/T61/PLAN.md")).toBe("T61");
    expect(m!.taskRef("tasks/T7/PLAN.md")).toBe("T7");
    expect(m!.taskRef("/r/tasks/hermes-run-status/PLAN.md")).toBe("hermes-run-status");
  });

  test("formato novo devolve PLAN-NNNN/TASK-NN", async () => {
    const m = await loadRef();
    expect(m).not.toBeNull();
    expect(m!.taskRef("/w/.ginga/plans/PLAN-0005-pinga-task-e-plan/TASK-02-task-ref.md")).toBe("PLAN-0005/TASK-02");
    expect(m!.taskRef(".ginga/plans/PLAN-0012-roda-web/TASK-10-x.md")).toBe("PLAN-0012/TASK-10");
  });
});

describe("verify e prove-red usam o resolvedor", () => {
  test("verify de tasks/T7/PLAN.md continua selando task T7", () => {
    const p = put("tasks/T7/PLAN.md", TASK());
    const r = run(["verify", p, "--ledger", ledger]);
    expect(r.code).toBe(0);
    expect(r.receipt?.task).toBe("T7");
    expect(r.receipt?.status).toBe("pass");
  });

  test("verify de uma TASK-*.md sela task PLAN-0005/TASK-02", () => {
    const p = put(".ginga/plans/PLAN-0005-x/TASK-02-y.md", TASK());
    const r = run(["verify", p, "--ledger", ledger]);
    expect(r.code).toBe(0);
    expect(r.receipt?.task).toBe("PLAN-0005/TASK-02");
    expect(r.receipt?.status).toBe("pass");
  });

  test("duas TASKs do mesmo PLAN recebem refs distintas", () => {
    const a = put(".ginga/plans/PLAN-0005-x/TASK-01-a.md", TASK());
    const b = put(".ginga/plans/PLAN-0005-x/TASK-02-b.md", TASK());
    expect(run(["verify", a, "--ledger", ledger]).receipt?.task).toBe("PLAN-0005/TASK-01");
    expect(run(["verify", b, "--ledger", ledger]).receipt?.task).toBe("PLAN-0005/TASK-02");
  });

  test("prove-red de uma TASK-*.md sela prove_red com a ref nova", () => {
    const git = (...a: string[]) =>
      Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: ws, stdout: "pipe", stderr: "pipe" });
    git("commit", "-q", "--allow-empty", "-m", "init");
    put("tests/x.test.ts", "// teste congelado\n");
    const p = put(".ginga/plans/PLAN-0005-x/TASK-02-y.md", TASK("test -f tests/x.test.ts && exit 3"));
    const r = run(["prove-red", p, "--ledger", ledger, "--base", "HEAD"]);
    expect(r.err).not.toContain("sem base");
    expect(r.receipt?.task).toBe("PLAN-0005/TASK-02");
    expect(r.receipt?.flow).toBe("prove_red");
    expect(r.receipt?.status).toBe("pass");
  });
});
