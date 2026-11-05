import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { nextTask, scanQueue } from "../src/queue";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

let ws: string;
let ledger: string;
beforeEach(() => {
  ws = realpathSync(mkdtempSync(join(tmpdir(), "pinga-queue-bundle-")));
  ledger = join(ws, "ledger.db");
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

function put(rel: string, text: string): string {
  const p = join(ws, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

const plan = (folder: string, status: string) =>
  put(
    `.ginga/plans/${folder}/PLAN.md`,
    `---\ntype: plan\ntitle: t\nintent: INTENT-0001-x\nstatus: ${status}\ndone_when: "true"\n---\n`,
  );

function task(folder: string, name: string, deps: string[] = []) {
  return put(
    `.ginga/plans/${folder}/${name}.md`,
    [
      "---",
      "type: task",
      "mode: mvp",
      `goal: "goal ${name}"`,
      `plan: ${folder}`,
      `depends_on: [${deps.join(", ")}]`,
      'done_when: "true"',
      "---",
      "corpo",
    ].join("\n") + "\n",
  );
}

function verify(taskPath: string) {
  Bun.spawnSync(["bun", BIN, "verify", taskPath, "--ledger", ledger], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
}

const scan = () => scanQueue({ root: ws, ledgerPath: ledger });
const byTask = (r: ReturnType<typeof scan>, ref: string) => r.tasks.find((t) => t.task === ref) as any;

describe("scanQueue enxerga o bundle", () => {
  test("lista TASK-*.md de PLAN approved com plan, task (ref) e blocked_by", () => {
    plan("PLAN-0001-a", "approved");
    task("PLAN-0001-a", "TASK-01-x");
    task("PLAN-0001-a", "TASK-02-y", ["TASK-01-x"]);
    const r = scan();
    const refs = r.tasks.map((t) => t.task).sort();
    expect(refs).toEqual(["PLAN-0001/TASK-01", "PLAN-0001/TASK-02"]);
    const t1 = byTask(r, "PLAN-0001/TASK-01");
    const t2 = byTask(r, "PLAN-0001/TASK-02");
    expect(t1.plan).toMatch(/^PLAN-0001/);
    expect(t1.goal).toBe("goal TASK-01-x");
    expect(t1.blocked_by).toEqual([]);
    expect(t2.blocked_by).toEqual(["PLAN-0001/TASK-01"]);
  });

  test("PLAN draft ou superseded fica de fora", () => {
    plan("PLAN-0001-a", "approved");
    task("PLAN-0001-a", "TASK-01-x");
    plan("PLAN-0002-b", "draft");
    task("PLAN-0002-b", "TASK-01-x");
    plan("PLAN-0003-c", "superseded");
    task("PLAN-0003-c", "TASK-01-x");
    expect(scan().tasks.map((t) => t.task)).toEqual(["PLAN-0001/TASK-01"]);
  });

  test("status vem do ledger: TASK com receipt pass vira done e destrava a dependente", () => {
    plan("PLAN-0001-a", "approved");
    const t1 = task("PLAN-0001-a", "TASK-01-x");
    task("PLAN-0001-a", "TASK-02-y", ["TASK-01-x"]);
    verify(t1);
    const r = scan();
    expect(byTask(r, "PLAN-0001/TASK-01").state).toBe("done");
    expect(byTask(r, "PLAN-0001/TASK-01").receipt?.status).toBe("pass");
    expect(byTask(r, "PLAN-0001/TASK-02").blocked_by).toEqual([]);
  });

  test("nextTask respeita depends_on, mesmo quando a dependente vem primeiro na ordem", () => {
    plan("PLAN-0001-a", "approved");
    const t2 = task("PLAN-0001-a", "TASK-02-b");
    task("PLAN-0001-a", "TASK-01-a", ["TASK-02-b"]);
    expect(nextTask(scan().tasks)?.task).toBe("PLAN-0001/TASK-02");
    verify(t2);
    expect(nextTask(scan().tasks)?.task).toBe("PLAN-0001/TASK-01");
  });

  test("o legado tasks/T* continua listado ao lado do bundle", () => {
    plan("PLAN-0001-a", "approved");
    task("PLAN-0001-a", "TASK-01-x");
    put("tasks/T7/PLAN.md", '---\nmode: mvp\ngoal: "legado"\ndone_when: "true"\n---\n');
    const refs = scan().tasks.map((t) => t.task);
    expect(refs).toContain("T7");
    expect(refs).toContain("PLAN-0001/TASK-01");
  });
});

describe("pinga queue --json", () => {
  test("inclui schema_version e as entradas do bundle", () => {
    plan("PLAN-0001-a", "approved");
    task("PLAN-0001-a", "TASK-01-x");
    const r = Bun.spawnSync(["bun", BIN, "queue", "--json", "--root", ws, "--ledger", ledger], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(r.exitCode).toBe(0);
    const j = JSON.parse(r.stdout.toString());
    expect(typeof j.schema_version).toBe("number");
    const e = j.tasks.find((t: any) => t.task === "PLAN-0001/TASK-01");
    expect(e).toBeDefined();
    expect(e.blocked_by).toEqual([]);
    expect(e.plan).toMatch(/^PLAN-0001/);
  });
});
