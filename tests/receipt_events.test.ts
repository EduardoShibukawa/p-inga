import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openLedger } from "../src/ledger";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

let dir: string;
let ledger: string;
let events: string;
const saved = process.env.GINGA_EVENTS;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pinga-events-"));
  ledger = join(dir, "ledger.db");
  events = join(dir, "events.jsonl");
});
afterEach(() => {
  if (saved === undefined) delete process.env.GINGA_EVENTS;
  else process.env.GINGA_EVENTS = saved;
  rmSync(dir, { recursive: true, force: true });
});

function receipt(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    type: "task.receipt",
    id: "rcpt-0001",
    task: "T01",
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [
      {
        kind: "command",
        cmd_sha256: "a".repeat(64),
        exit: 0,
        duration_ms: 15,
        artifact_ref: { path: "runs/T01/1/out.txt", sha256: "b".repeat(64) },
      },
    ],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: "deepseek-v4-pro", family: "deepseek" },
    verified_by: null,
    summary: "T01 pass: done_when exit 0 em 0s",
    created_at: "2026-10-24T17:20:01.000Z",
    ...over,
  };
}

const lines = (): Record<string, any>[] =>
  (existsSync(events) ? readFileSync(events, "utf8") : "")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

function append(r: Record<string, unknown>) {
  const led = openLedger(ledger);
  try {
    return led.append(r);
  } finally {
    led.close();
  }
}

describe("ledger.append emite receipt v1", () => {
  test("envelope e data do receipt selado", () => {
    process.env.GINGA_EVENTS = events;
    const res = append(receipt({ repo: "/r/.git" }));
    const [ev] = lines();
    expect(ev).toBeDefined();
    expect(ev!.v).toBe(1);
    expect(ev!.source).toBe("pinga");
    expect(ev!.kind).toBe("receipt");
    expect(typeof ev!.id).toBe("string");
    expect(ev!.id.length).toBeGreaterThanOrEqual(16);
    expect(new Date(ev!.ts).toISOString()).toBe(ev!.ts);
    expect(ev!.task).toBe("T01");
    expect(ev!.repo).toBe("/r/.git");
    expect(ev!.data.ledger_n).toBe(res.seq);
    expect(ev!.data.hash).toBe(res.hash);
    expect(ev!.data.status).toBe("pass");
    expect("reason_code" in ev!.data).toBe(false); // v1 omite chaves null (07-eventos.md)
    expect(ev!.data.check).toBe("verify");
  });

  test("check segue o flow do receipt: prove_red → prove-red, judge → judge", () => {
    process.env.GINGA_EVENTS = events;
    append(receipt({ id: "r1", flow: "prove_red" }));
    append(receipt({ id: "r2", flow: "judge" }));
    append(receipt({ id: "r3", status: "fail", reason_code: "command_failed" }));
    const evs = lines();
    expect(evs.map((e) => e.data.check)).toEqual(["prove-red", "judge", "verify"]);
    expect(evs[2]!.data.status).toBe("fail");
    expect(evs[2]!.data.reason_code).toBe("command_failed");
    expect(evs.map((e) => e.data.ledger_n)).toEqual([1, 2, 3]);
  });

  test("faz append (não trunca), um evento por linha, cada linha < 4 KiB", () => {
    process.env.GINGA_EVENTS = events;
    writeFileSync(events, '{"linha":"preexistente"}\n');
    append(receipt({ id: "r1" }));
    append(receipt({ id: "r2" }));
    const evs = lines();
    expect(evs.length).toBe(3);
    expect(evs[0]).toEqual({ linha: "preexistente" });
    expect(evs[1]!.id).not.toBe(evs[2]!.id);
    for (const l of readFileSync(events, "utf8").split("\n").filter(Boolean)) {
      expect(l.length).toBeLessThan(4096);
    }
  });
});

describe("sem efeito quando a variável não existe ou falha", () => {
  test("sem $GINGA_EVENTS nada é escrito e o append segue funcionando", () => {
    delete process.env.GINGA_EVENTS;
    const res = append(receipt());
    expect(res.seq).toBe(1);
    expect(existsSync(events)).toBe(false);
  });

  test("falha ao emitir nunca falha o ledger", () => {
    process.env.GINGA_EVENTS = join(dir, "nao", "existe", "events.jsonl");
    const res = append(receipt());
    expect(res.seq).toBe(1);
    expect(res.hash).toMatch(/^[0-9a-f]{64}$/);
    const led = openLedger(ledger);
    expect(led.verify()).toEqual({ ok: true, count: 1 });
    led.close();
  });
});

describe("pinga verify / prove-red", () => {
  function pinga(args: string[]) {
    return Bun.spawnSync(["bun", BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, GINGA_EVENTS: events },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  test("cada receipt selado pelo verify vira um evento receipt", () => {
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo });
    const p = join(repo, "tasks", "T7", "PLAN.md");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, ["---", "mode: mvp", 'goal: "g"', 'done_when: "true"', "---", "x"].join("\n") + "\n");
    const r = pinga(["verify", p, "--ledger", ledger]);
    expect(r.exitCode).toBe(0);
    const evs = lines();
    expect(evs.length).toBe(1);
    expect(evs[0]!.source).toBe("pinga");
    expect(evs[0]!.kind).toBe("receipt");
    expect(evs[0]!.task).toBe("T7");
    expect(evs[0]!.data.status).toBe("pass");
    expect(evs[0]!.data.check).toBe("verify");
    expect(evs[0]!.data.ledger_n).toBe(1);
  });

  test("sem $GINGA_EVENTS o verify não cria arquivo de eventos", () => {
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: repo });
    const p = join(repo, "tasks", "T7", "PLAN.md");
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, ["---", "mode: mvp", 'goal: "g"', 'done_when: "true"', "---", "x"].join("\n") + "\n");
    const env = { ...process.env };
    delete env.GINGA_EVENTS;
    const r = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", ledger], { cwd: ROOT, env, stdout: "pipe", stderr: "pipe" });
    expect(r.exitCode).toBe(0);
    expect(existsSync(events)).toBe(false);
  });
});
