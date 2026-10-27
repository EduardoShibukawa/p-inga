import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";
import { scanQueue } from "../src/queue";
import type { Receipt } from "../src/receipt";

/**
 * `prove-red` emite recibo `status: pass` quando prova que o contrato REPROVA no
 * base — é o oposto de concluir a task. Se a fila contar esse recibo como
 * conclusão, toda task enfileirada com RED já provado nasce `done` e nunca é
 * executada: a fila se esvazia sozinha. Só recibo de verificação (`verify`) ou
 * de juiz (`judge`) fecha task; `prove_red` nunca fecha.
 */
function makeReceipt(
  task: string,
  status: Receipt["status"],
  overrides: Partial<Receipt> = {},
): Receipt {
  return {
    v: 1,
    type: "task.receipt",
    id: `rcpt-${task}-${status}-${Math.random()}`,
    task,
    status,
    reason_code: status === "pass" ? null : "command_failed",
    attempts: 1,
    evidence: [],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: null, family: null },
    verified_by: null,
    summary: `${task} ${status}`,
    created_at: "2026-10-27T20:00:00.000Z",
    ...overrides,
  } as Receipt;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pinga-qred-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-qred-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");

  const plan = (task: string) => {
    const dir = join(root, "tasks", task);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "PLAN.md"),
      ["---", "mode: mvp", `goal: "${task} goal"`, 'done_when: "true"', "---", ""].join("\n"),
    );
  };

  const receipt = (r: Receipt) => {
    const led = openLedger(ledgerPath);
    led.append(r);
    led.close();
  };

  return {
    plan,
    receipt,
    state: (task: string) =>
      scanQueue({ root, ledgerPath, probe: false }).tasks.find((e) => e.task === task)?.state,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

describe("Q-prove-red — recibo de RED não conclui task", () => {
  test("prove_red pass sozinho deixa a task reexecutável", () => {
    const f = fixture();
    try {
      f.plan("T91");
      f.receipt(makeReceipt("T91", "pass", { flow: "prove_red" } as Partial<Receipt>));
      expect(f.state("T91")).toBe("open");
    } finally {
      f.cleanup();
    }
  });

  test("prove_red pass + blocked processual não vira done", () => {
    const f = fixture();
    try {
      f.plan("T92");
      f.receipt(makeReceipt("T92", "pass", { flow: "prove_red" } as Partial<Receipt>));
      f.receipt(
        makeReceipt("T92", "blocked", {
          reason_code: "delta_no_touch" as Receipt["reason_code"],
          attempts: 2,
        }),
      );
      expect(f.state("T92")).toBe("blocked");
    } finally {
      f.cleanup();
    }
  });

  test("verify pass depois do RED conclui", () => {
    const f = fixture();
    try {
      f.plan("T93");
      f.receipt(makeReceipt("T93", "pass", { flow: "prove_red" } as Partial<Receipt>));
      f.receipt(makeReceipt("T93", "pass", { flow: "verify" } as Partial<Receipt>));
      expect(f.state("T93")).toBe("done");
    } finally {
      f.cleanup();
    }
  });

  test("verify fail depois do RED mantém a task aberta", () => {
    const f = fixture();
    try {
      f.plan("T94");
      f.receipt(makeReceipt("T94", "pass", { flow: "prove_red" } as Partial<Receipt>));
      f.receipt(makeReceipt("T94", "fail"));
      expect(f.state("T94")).toBe("open");
    } finally {
      f.cleanup();
    }
  });
});
