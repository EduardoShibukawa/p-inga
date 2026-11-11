import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";

/**
 * `pinga ledger list --json` (T903): leitura do ledger para a tela Ledger da
 * Roda Web. Uma linha JSON `{chain, total, rows}`, do mais novo para o mais
 * antigo; só leitura.
 */
const BIN = join(import.meta.dir, "..", "bin", "pinga.ts");
const dirs: string[] = [];

function receipt(task: string, over: Record<string, unknown> = {}) {
  return {
    v: 1,
    type: "task.receipt",
    id: `rcpt-${task}-${Math.random()}`,
    task,
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: null, family: null },
    verified_by: null,
    summary: `${task} pass`,
    created_at: "2026-11-09T08:00:00.000Z",
    flow: "verify",
    repo: "/home/dono/ws/manda/.git",
    ...over,
  };
}

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "pinga-ledger-list-"));
  dirs.push(dir);
  const path = join(dir, "ledger.db");
  const led = openLedger(path);
  led.append(receipt("T1", { flow: "prove_red", summary: "T1 pass: RED falha no base" }));
  led.append(receipt("T1", { author: { model: "glm-5", family: "zhipu" }, created_at: "2026-11-09T09:00:00.000Z" }));
  led.append(
    receipt("T2", {
      status: "blocked",
      reason_code: "scope_drift",
      summary: "T2 blocked: scope_drift",
      repo: "/home/dono/ws/g-inga/.git",
      created_at: "2026-11-09T10:00:00.000Z",
    }),
  );
  led.close();
  return path;
}

function list(ledger: string, extra: string[] = []) {
  const r = Bun.spawnSync(["bun", BIN, "ledger", "list", "--json", "--ledger", ledger, ...extra], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString() };
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("pinga ledger list --json", () => {
  test("uma linha JSON com a cadeia e os receipts, do mais novo para o mais antigo", () => {
    const r = list(fixture());
    expect(r.code).toBe(0);
    expect(r.out.split("\n").length).toBe(1);
    const j = JSON.parse(r.out);
    expect(j.chain).toEqual({ ok: true, count: 3 });
    expect(j.total).toBe(3);
    expect(j.rows.map((x: any) => x.seq)).toEqual([3, 2, 1]);
  });

  test("cada linha traz task, status, flow, repo (nome da pasta), modelo, quando e hash", () => {
    const j = JSON.parse(list(fixture()).out);
    const [blocked, verify, red] = j.rows;
    expect(blocked).toMatchObject({
      seq: 3,
      task: "T2",
      status: "blocked",
      flow: "verify",
      repo: "g-inga",
      model: null,
      reason_code: "scope_drift",
      created_at: "2026-11-09T10:00:00.000Z",
      summary: "T2 blocked: scope_drift",
    });
    expect(blocked.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verify).toMatchObject({ seq: 2, task: "T1", status: "pass", flow: "verify", repo: "manda", model: "glm-5" });
    expect(red).toMatchObject({ seq: 1, flow: "prove_red", repo: "manda" });
  });

  test("--limit corta a lista mas total continua sendo a cadeia inteira", () => {
    const j = JSON.parse(list(fixture(), ["--limit", "2"]).out);
    expect(j.rows.map((x: any) => x.seq)).toEqual([3, 2]);
    expect(j.total).toBe(3);
  });

  test("ledger vazio: cadeia íntegra com zero blocos", () => {
    const dir = mkdtempSync(join(tmpdir(), "pinga-ledger-vazio-"));
    dirs.push(dir);
    const j = JSON.parse(list(join(dir, "ledger.db")).out);
    expect(j).toEqual({ chain: { ok: true, count: 0 }, total: 0, rows: [] });
  });

  test("--limit inválido sai com 2", () => {
    expect(list(fixture(), ["--limit", "zero"]).code).toBe(2);
  });

  test("não escreve no ledger", () => {
    const path = fixture();
    list(path);
    list(path);
    const led = openLedger(path);
    expect(led.all().length).toBe(3);
    led.close();
  });
});
