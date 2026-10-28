import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { alwaysAllowed } from "../src/guards";
import { createTaskRequest } from "../src/maestro";
import { baselinePath } from "../src/queue";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

let ws: string;
let ledger: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "pinga-sidecar-"));
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: ws });
  writeFileSync(join(ws, ".gitignore"), ".pinga/\nruns/\n");
  ledger = join(ws, ".pinga", "ledger.db");
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

function put(rel: string, text: string): string {
  const p = join(ws, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

const TASK = (doneWhen = "true", touch = '["src/a.ts"]') =>
  [
    "---",
    "type: task",
    "mode: mvp",
    'goal: "g"',
    "plan: PLAN-0005-x",
    `touch: ${touch}`,
    `done_when: ${JSON.stringify(doneWhen)}`,
    "---",
    "corpo",
  ].join("\n") + "\n";

const NEW = ".ginga/plans/PLAN-0005-x/TASK-02-y.md";

function git(...a: string[]) {
  const r = Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...a], {
    cwd: ws,
    stdout: "pipe",
    stderr: "pipe",
  });
  return r.stdout.toString().trim();
}

function pinga(args: string[], cwd = ROOT) {
  const r = Bun.spawnSync(["bun", BIN, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const lines = r.stdout.toString().trim().split("\n").filter(Boolean);
  let json: Record<string, any> | null = null;
  try {
    json = JSON.parse(lines[lines.length - 1] ?? "");
  } catch {}
  return { code: r.exitCode, json, err: r.stderr.toString() };
}

describe("taskSidecarDir", () => {
  test("legado fica em tasks/T<N>/; formato novo em <pasta do PLAN>/.pinga/TASK-NN/", async () => {
    let mod: { taskSidecarDir: (p: string) => string } | null = null;
    try {
      mod = await import(join(ROOT, "src/task_ref.ts"));
    } catch {}
    expect(mod).not.toBeNull();
    expect(mod!.taskSidecarDir("/r/tasks/T61/PLAN.md")).toBe("/r/tasks/T61");
    expect(mod!.taskSidecarDir("/w/.ginga/plans/PLAN-0005-x/TASK-02-y.md")).toBe(
      "/w/.ginga/plans/PLAN-0005-x/.pinga/TASK-02",
    );
  });
});

describe("legado intacto", () => {
  test("baselinePath e alwaysAllowed seguem apontando para tasks/T<N>/", () => {
    expect(baselinePath("/r", "T61")).toBe("/r/tasks/T61/.baseline.json");
    expect(alwaysAllowed("T61")).toEqual(["tasks/T61/EXEC.md", "tasks/T61/EVAL.md"]);
  });
});

describe("comandos usam taskRef", () => {
  test("mode: task legado T7, task nova PLAN-0005/TASK-02", () => {
    const legacy = put("tasks/T7/PLAN.md", TASK());
    const novo = put(NEW, TASK());
    expect(pinga(["mode", legacy]).json?.task).toBe("T7");
    expect(pinga(["mode", novo]).json?.task).toBe("PLAN-0005/TASK-02");
  });

  test("maestro: createTaskRequest usa a ref como id", () => {
    const legacy = put("tasks/T7/PLAN.md", TASK());
    const novo = put(NEW, TASK());
    expect(createTaskRequest(legacy).id).toBe("T7");
    expect(createTaskRequest(novo).id).toBe("PLAN-0005/TASK-02");
  });

  test("supersede aceita o id legado T<N> (a partir da raiz do repo)", () => {
    put("tasks/T7/PLAN.md", TASK());
    const r = pinga(["supersede", "T7", "--reason", "já satisfeito", "--ledger", ledger], ws);
    expect(r.json?.task).toBe("T7");
    expect(r.json?.reason_code).toBe("superseded");
  });

  test("supersede aceita o caminho de uma TASK-*.md e sela a ref nova", () => {
    const novo = put(NEW, TASK());
    const r = pinga(["supersede", novo, "--reason", "já satisfeito", "--ledger", ledger]);
    expect(r.json?.task).toBe("PLAN-0005/TASK-02");
    expect(r.json?.reason_code).toBe("superseded");
  });
});

describe("baseline do claim no sidecar novo", () => {
  function setup() {
    const task = put(NEW, TASK());
    put("src/a.ts", "export {};\n");
    git("add", ".gitignore", ".ginga", "src");
    git("commit", "-q", "-m", "init");
    return { task, head: git("rev-parse", "HEAD") };
  }

  test("sem baseline, --require-delta não acha base e passa", () => {
    const { task } = setup();
    const r = pinga(["verify", task, "--ledger", ledger, "--require-delta"]);
    expect(r.json?.task).toBe("PLAN-0005/TASK-02");
    expect(r.json?.status).toBe("pass");
  });

  test("verify lê <PLAN>/.pinga/TASK-02/.baseline.json: nada mudou desde o HEAD → delta_no_touch", () => {
    const { task, head } = setup();
    put(
      ".ginga/plans/PLAN-0005-x/.pinga/TASK-02/.baseline.json",
      JSON.stringify({ v: 1, head, dirty: {} }),
    );
    const r = pinga(["verify", task, "--ledger", ledger, "--require-delta"]);
    expect(r.json?.task).toBe("PLAN-0005/TASK-02");
    expect(r.json?.reason_code).toBe("delta_no_touch");
    expect(r.code).toBe(7);
  });
});
