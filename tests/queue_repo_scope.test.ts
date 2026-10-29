import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";
import { scanQueue } from "../src/queue";
import type { Receipt } from "../src/receipt";

/**
 * A fila casava receipts só pelo número da task (T4 ≡ T04) e ignorava o `repo`
 * do recibo: um `pass` de T4 em outro repo fechava a T04 deste. Recibo com
 * `repo` de outro escopo não conta; recibo do mesmo escopo e legado (sem `repo`) contam.
 */
function receipt(task: string, repo?: string): Receipt {
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
    created_at: "2026-10-29T08:00:00.000Z",
    flow: "verify",
    ...(repo !== undefined ? { repo } : {}),
  } as Receipt;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pinga-qscope-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-qscope-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");
  Bun.spawnSync(["git", "init", "-q", root]);
  const scope = realpathSync(join(root, ".git"));
  for (const task of ["T04", "T05", "T06"]) {
    const dir = join(root, "tasks", task);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "PLAN.md"),
      ["---", "mode: mvp", `goal: "${task} goal"`, 'done_when: "true"', "---", ""].join("\n"),
    );
  }
  const led = openLedger(ledgerPath);
  led.append(receipt("T4", "/outro/repo/.git"));
  led.append(receipt("T05", scope));
  led.append(receipt("T06"));
  led.close();
  return {
    state: (task: string) =>
      scanQueue({ root, ledgerPath, probe: false }).tasks.find((e) => e.task === task)?.state,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

describe("fila — recibos respeitam o escopo do repo", () => {
  test("pass de T4 em outro repo não fecha a T04 deste", () => {
    const f = fixture();
    try {
      expect(f.state("T04")).toBe("open");
    } finally {
      f.cleanup();
    }
  });

  test("pass do mesmo repo fecha a task", () => {
    const f = fixture();
    try {
      expect(f.state("T05")).toBe("done");
    } finally {
      f.cleanup();
    }
  });

  test("recibo legado (sem repo) continua valendo", () => {
    const f = fixture();
    try {
      expect(f.state("T06")).toBe("done");
    } finally {
      f.cleanup();
    }
  });
});
