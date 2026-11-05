import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

let ws: string;
let ledger: string;
let marker: string;
beforeEach(() => {
  ws = realpathSync(mkdtempSync(join(tmpdir(), "pinga-planverify-")));
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: ws });
  ledger = join(ws, ".pinga", "ledger.db");
  marker = join(ws, "integracao.ok");
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

function put(rel: string, text: string): string {
  const p = join(ws, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

const FOLDER = ".ginga/plans/PLAN-0005-x";

function planMd(doneWhen: string, o: { kind?: string; extraLines?: number } = {}) {
  return (
    [
      "---",
      "type: plan",
      "title: Plan de teste",
      "intent: INTENT-0001-x",
      `kind: ${o.kind ?? "change"}`,
      "status: approved",
      `done_when: ${JSON.stringify(doneWhen)}`,
      "---",
      "## Abordagem",
      ...Array.from({ length: o.extraLines ?? 0 }, (_, i) => `- linha ${i}`),
    ].join("\n") + "\n"
  );
}

const taskMd = (doneWhen = "true") =>
  [
    "---",
    "type: task",
    "mode: mvp",
    'goal: "g"',
    "plan: PLAN-0005-x",
    `done_when: ${JSON.stringify(doneWhen)}`,
    "---",
    "corpo",
  ].join("\n") + "\n";

function pinga(args: string[]) {
  const r = Bun.spawnSync(["bun", BIN, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  const lines = r.stdout.toString().trim().split("\n").filter(Boolean);
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(lines[lines.length - 1] ?? "");
  } catch {}
  return { code: r.exitCode, json, err: r.stderr.toString() };
}

const verifyPlan = (p: string) => pinga(["verify", p, "--ledger", ledger]);

describe("pinga verify <PLAN.md> (type: plan)", () => {
  test("TASKs sem receipt pass → blocked/tasks_open listando todas, sem rodar o done_when", () => {
    const plan = put(`${FOLDER}/PLAN.md`, planMd(`touch ${marker}`));
    put(`${FOLDER}/TASK-01-a.md`, taskMd());
    put(`${FOLDER}/TASK-02-b.md`, taskMd());
    const r = verifyPlan(plan);
    expect(r.code).not.toBe(0);
    expect(r.json?.status).toBe("blocked");
    expect(r.json?.reason_code).toBe("tasks_open");
    expect(r.json?.task).toBe("PLAN-0005");
    expect(r.json?.summary).toContain("TASK-01");
    expect(r.json?.summary).toContain("TASK-02");
    expect(existsSync(marker)).toBe(false);
  });

  test("só as TASKs sem pass entram na lista", () => {
    const plan = put(`${FOLDER}/PLAN.md`, planMd(`touch ${marker}`));
    const t1 = put(`${FOLDER}/TASK-01-a.md`, taskMd());
    put(`${FOLDER}/TASK-02-b.md`, taskMd());
    expect(pinga(["verify", t1, "--ledger", ledger]).json?.status).toBe("pass");
    const r = verifyPlan(plan);
    expect(r.json?.reason_code).toBe("tasks_open");
    expect(r.json?.summary).toContain("TASK-02");
    expect(r.json?.summary).not.toContain("TASK-01");
    expect(existsSync(marker)).toBe(false);
  });

  test("todas as TASKs pass → roda o done_when e sela pass (task PLAN-NNNN, check plan)", () => {
    const plan = put(`${FOLDER}/PLAN.md`, planMd(`touch ${marker}`));
    const t1 = put(`${FOLDER}/TASK-01-a.md`, taskMd());
    const t2 = put(`${FOLDER}/TASK-02-b.md`, taskMd());
    pinga(["verify", t1, "--ledger", ledger]);
    pinga(["verify", t2, "--ledger", ledger]);
    const r = verifyPlan(plan);
    expect(r.code).toBe(0);
    expect(r.json?.status).toBe("pass");
    expect(r.json?.task).toBe("PLAN-0005");
    expect(r.json?.check).toBe("plan");
    expect(existsSync(marker)).toBe(true);
  });

  test("done_when do PLAN falhando depois das TASKs pass → fail/command_failed", () => {
    const plan = put(`${FOLDER}/PLAN.md`, planMd("exit 9"));
    const t1 = put(`${FOLDER}/TASK-01-a.md`, taskMd());
    pinga(["verify", t1, "--ledger", ledger]);
    const r = verifyPlan(plan);
    expect(r.code).toBe(1);
    expect(r.json?.status).toBe("fail");
    expect(r.json?.reason_code).toBe("command_failed");
    expect(r.json?.task).toBe("PLAN-0005");
  });

  test("não aplica o limite de 25 linhas ao PLAN", () => {
    const plan = put(`${FOLDER}/PLAN.md`, planMd("true", { extraLines: 60 }));
    const t1 = put(`${FOLDER}/TASK-01-a.md`, taskMd());
    pinga(["verify", t1, "--ledger", ledger]);
    const r = verifyPlan(plan);
    expect(r.json?.status).toBe("pass");
    expect(r.json?.reason_code).toBeNull();
  });

  test("PLAN sem done_when → plan_invalid, exit 3", () => {
    const plan = put(
      `${FOLDER}/PLAN.md`,
      ["---", "type: plan", "title: t", "status: approved", "---", "x"].join("\n") + "\n",
    );
    put(`${FOLDER}/TASK-01-a.md`, taskMd());
    const r = verifyPlan(plan);
    expect(r.code).toBe(3);
    expect(r.json?.reason_code).toBe("plan_invalid");
  });

  test("PLAN sem nenhuma TASK-*.md não passa", () => {
    const plan = put(`${FOLDER}/PLAN.md`, planMd("true"));
    const r = verifyPlan(plan);
    expect(r.code).not.toBe(0);
    expect(r.json?.status).not.toBe("pass");
  });

  test("kind: investigation segue o mesmo caminho (hipóteses como TASKs)", () => {
    const plan = put(`${FOLDER}/PLAN.md`, planMd(`touch ${marker}`, { kind: "investigation" }));
    const h1 = put(`${FOLDER}/TASK-01-hipotese-cache.md`, taskMd());
    put(`${FOLDER}/TASK-02-hipotese-lock.md`, taskMd());
    const aberto = verifyPlan(plan);
    expect(aberto.json?.reason_code).toBe("tasks_open");
    expect(aberto.json?.summary).toContain("TASK-02");
    pinga(["verify", h1, "--ledger", ledger]);
    pinga(["verify", join(ws, `${FOLDER}/TASK-02-hipotese-lock.md`), "--ledger", ledger]);
    const r = verifyPlan(plan);
    expect(r.json?.status).toBe("pass");
    expect(r.json?.check).toBe("plan");
    expect(existsSync(marker)).toBe(true);
  });
});
