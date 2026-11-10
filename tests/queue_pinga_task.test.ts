import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openLedger } from "../src/ledger";
import { scanQueue } from "../src/queue";
import type { Receipt } from "../src/receipt";

/**
 * T902: TASK do bundle com `pinga_task: T<N>` (materializada pelo `manda red`
 * como `tasks/T<N>/PLAN.md` no repo dela) fecha com o receipt `pass` de T<N>
 * no git desse repo. Workspace real: raiz com `.ginga/` e os repos dentro.
 */
let ws: string;
let ledger: string;
let scope: string;
let other: string;

function put(rel: string, text: string) {
  const p = join(ws, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}

function receipt(task: string, repo: string | undefined, flow = "verify", status = "pass"): Receipt {
  return {
    v: 1,
    type: "task.receipt",
    id: `rcpt-${task}-${Math.random()}`,
    task,
    status,
    reason_code: null,
    attempts: 1,
    evidence: [],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: null, family: null },
    verified_by: null,
    summary: `${task} ${status}`,
    created_at: "2026-11-10T08:00:00.000Z",
    flow,
    ...(repo !== undefined ? { repo } : {}),
  } as Receipt;
}

function seal(...rs: Receipt[]) {
  const led = openLedger(ledger);
  for (const r of rs) led.append(r);
  led.close();
}

function task(name: string, extra: string[], deps: string[] = []) {
  put(
    `.ginga/plans/PLAN-0001-a/${name}.md`,
    ["---", "type: task", "mode: mvp", `goal: "goal ${name}"`, "plan: PLAN-0001-a", `depends_on: [${deps.join(", ")}]`, 'done_when: "true"', ...extra, "---", "corpo"].join("\n") + "\n",
  );
}

const state = (ref: string) => scanQueue({ root: ws, ledgerPath: ledger, probe: false }).tasks.find((t) => t.task === ref) as any;

beforeEach(() => {
  ws = realpathSync(mkdtempSync(join(tmpdir(), "pinga-alias-")));
  ledger = join(ws, "ledger.db");
  for (const repo of ["demo", "outro"]) {
    mkdirSync(join(ws, repo));
    Bun.spawnSync(["git", "init", "-q", join(ws, repo)]);
  }
  scope = realpathSync(join(ws, "demo", ".git"));
  other = realpathSync(join(ws, "outro", ".git"));
  put(".ginga/plans/PLAN-0001-a/PLAN.md", '---\ntype: plan\ntitle: t\nstatus: approved\ndone_when: "true"\n---\n');
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("fila do bundle com pinga_task", () => {
  test("receipt pass de T1 no repo da TASK fecha PLAN-0001/TASK-01", () => {
    task("TASK-01-x", ["repo: demo", "pinga_task: T1"]);
    seal(receipt("T1", scope));
    const t = state("PLAN-0001/TASK-01");
    expect(t.state).toBe("done");
    expect(t.receipt.status).toBe("pass");
  });

  test("receipt de T1 de outro repo não fecha", () => {
    task("TASK-01-x", ["repo: demo", "pinga_task: T1"]);
    seal(receipt("T1", other));
    expect(state("PLAN-0001/TASK-01").state).toBe("open");
  });

  test("só o prove-red de T1 não fecha", () => {
    task("TASK-01-x", ["repo: demo", "pinga_task: T1"]);
    seal(receipt("T1", scope, "prove_red"));
    expect(state("PLAN-0001/TASK-01").state).toBe("open");
  });

  test("sem pinga_task nada muda: T1 pass não fecha a TASK do bundle", () => {
    task("TASK-01-x", ["repo: demo"]);
    seal(receipt("T1", scope));
    expect(state("PLAN-0001/TASK-01").state).toBe("open");
  });

  test("depends_on enxerga o alias: TASK-02 destrava quando T1 passa", () => {
    task("TASK-01-x", ["repo: demo", "pinga_task: T1"]);
    task("TASK-02-y", ["repo: demo", "pinga_task: T2"], ["TASK-01-x"]);
    expect(state("PLAN-0001/TASK-02").blocked_by).toEqual(["PLAN-0001/TASK-01"]);
    seal(receipt("T1", scope));
    expect(state("PLAN-0001/TASK-02").blocked_by).toEqual([]);
  });

  test("último receipt de T1 blocked deixa a TASK blocked", () => {
    task("TASK-01-x", ["repo: demo", "pinga_task: T1"]);
    seal(receipt("T1", scope, "verify", "blocked"));
    expect(state("PLAN-0001/TASK-01").state).toBe("blocked");
  });
});
