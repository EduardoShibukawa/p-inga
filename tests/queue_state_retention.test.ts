import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";
import { canClaim, scanQueue } from "../src/queue";
import type { Receipt } from "../src/receipt";

/**
 * Um recibo `pass` já provou o contrato (`done_when` exit 0). Recibos posteriores
 * que não são verificação do contrato — juiz sem atestação de modelo, harness
 * indisponível, guarda de delta — não podem rebaixar a task de `done` para
 * `blocked`: `delta_no_touch` chega a dizer na própria mensagem que "o contrato já
 * passa no base". Só um recibo que reprove o contrato de verdade (`fail`, ou
 * `blocked` com código substantivo como `scope_drift`) tira a task de `done`.
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
    created_at: "2026-10-26T20:00:00.000Z",
    ...overrides,
  } as Receipt;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pinga-qret-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-qret-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");

  const plan = (task: string) => {
    const dir = join(root, "tasks", task);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "PLAN.md"),
      [
        "---",
        "mode: mvp",
        `goal: "${task} goal"`,
        'done_when: "true"',
        "---",
        "",
      ].join("\n"),
    );
  };

  const receipt = (r: Receipt) => {
    const led = openLedger(ledgerPath);
    led.append(r);
    led.close();
  };

  return {
    root,
    plan,
    receipt,
    scan: () => scanQueue({ root, ledgerPath, probe: false }),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

describe("Q-retention — recibo pass sobrevive a recibo processual posterior", () => {
  const cases: Array<[string, string]> = [
    ["delta_no_touch", "guarda de delta: contrato já verde no base, sem trabalho"],
    ["model_unattested", "juiz sem atestação de família de modelo"],
    ["infra", "harness/toolchain indisponível para provar no base"],
  ];

  for (const [code, why] of cases) {
    test(`pass + blocked/${code} continua done (${why})`, () => {
      const f = fixture();
      try {
        f.plan("T90");
        f.receipt(makeReceipt("T90", "pass", { summary: "T90 pass: done_when exit 0" }));
        f.receipt(
          makeReceipt("T90", "blocked", {
            reason_code: code as Receipt["reason_code"],
            attempts: 2,
          }),
        );
        const rep = f.scan();
        expect(rep.tasks[0].state).toBe("done");
        expect(rep.counts.done).toBe(1);
        expect(rep.counts.blocked).toBe(0);
      } finally {
        f.cleanup();
      }
    });
  }

  test("pass + blocked/scope_drift volta a blocked: código substantivo revoga o pass", () => {
    const f = fixture();
    try {
      f.plan("T91");
      f.receipt(makeReceipt("T91", "pass"));
      f.receipt(
        makeReceipt("T91", "blocked", {
          reason_code: "scope_drift" as Receipt["reason_code"],
          attempts: 2,
        }),
      );
      expect(f.scan().tasks[0].state).toBe("blocked");
    } finally {
      f.cleanup();
    }
  });

  test("blocked/delta_no_touch sem pass continua blocked (guarda não afrouxou)", () => {
    const f = fixture();
    try {
      f.plan("T92");
      f.receipt(
        makeReceipt("T92", "blocked", {
          reason_code: "delta_no_touch" as Receipt["reason_code"],
        }),
      );
      expect(f.scan().tasks[0].state).toBe("blocked");
    } finally {
      f.cleanup();
    }
  });
});

describe("Q-claim — só abre lease no que ainda tem trabalho", () => {
  test("done e superseded recusam claim; open/blocked/awaiting_receipt aceitam", () => {
    expect(canClaim("done")).toBe(false);
    expect(canClaim("superseded")).toBe(false);
    expect(canClaim("invalid_plan")).toBe(false);
    expect(canClaim("open")).toBe(true);
    expect(canClaim("blocked")).toBe(true);
    expect(canClaim("awaiting_receipt")).toBe(true);
  });
});
