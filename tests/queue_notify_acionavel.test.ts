import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NOTIFY_STATES } from "../src/queue";
import { verifyPlan } from "../src/verify";

// T60 — o vigia da fila roda a cada 5 min com `--notify` e manda para o
// Discord o digest INTEIRO: cabeçalho de contagens + uma linha por task (55
// tasks hoje) a cada transição avisável, mesmo quando só uma task mudou. Para
// o operador isso é ruído: ele só precisa saber o que terminou e o que está
// parado esperando ação dele.
//
// Contrato:
//  1. `notice` (o texto que vai para o Discord) existe no JSON do `queue` e é
//     `null` quando não há transição acionável.
//  2. Quando há, `notice` traz SÓ as tasks que transicionaram para um estado
//     acionável — nenhuma task parada é citada — precedido de uma linha curta
//     de contagem.
//  3. `done`, `blocked`, `invalid_plan` e `awaiting_receipt` avisam;
//     `superseded` (ato nosso), `open` (enfileiramento é ato nosso) e `leased`
//     (executor trabalhando) não avisam.
//  4. Duas rodadas seguidas sem mudança: a segunda tem `notice: null`.

const PINGA = join(import.meta.dir, "..", "bin", "pinga.ts");
const REPO = join(import.meta.dir, "..");

type QueueOut = {
  counts: Record<string, number>;
  transitions: { task: string; from: string | null; to: string }[];
  notice: string | null;
};

function planText(task: string, doneWhen: string): string {
  return [
    "---",
    "mode: mvp",
    `goal: task ${task} do teste de notificacao`,
    `done_when: "${doneWhen}"`,
    "touch:",
    `  - tasks/${task}/PLAN.md`,
    "---",
    `# ${task}`,
    "",
  ].join("\n");
}

function mkRoot(tasks: { task: string; doneWhen: string }[]): string {
  const root = mkdtempSync(join(tmpdir(), "pinga-t60-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  for (const t of tasks) {
    mkdirSync(join(root, "tasks", t.task), { recursive: true });
    writeFileSync(join(root, "tasks", t.task, "PLAN.md"), planText(t.task, t.doneWhen));
  }
  return root;
}

function queue(root: string, ledger: string): QueueOut {
  const proc = Bun.spawnSync(
    [process.execPath, PINGA, "queue", "--json", "--root", root, "--ledger", ledger],
    { cwd: REPO },
  );
  const out = proc.stdout.toString();
  const err = proc.stderr.toString();
  if (proc.exitCode !== 0) throw new Error(`queue exit ${proc.exitCode}: ${out}${err}`);
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`queue sem JSON: ${out}`);
  return JSON.parse(out.slice(start)) as QueueOut;
}

describe("T60 · aviso do vigia so com task acionavel", () => {
  test("task concluida avisa sozinha, sem citar as paradas", () => {
    const root = mkRoot([
      { task: "T60a", doneWhen: "true" },
      { task: "T60b", doneWhen: "true" },
    ]);
    const ledger = join(root, "q.db");

    // run 1: tudo `open` — enfileirar é ato nosso, não avisa.
    expect(queue(root, ledger).notice).toBeNull();

    // run 2: só T60a foi executada e selou recibo `pass`.
    verifyPlan(join(root, "tasks", "T60a", "PLAN.md"), ledger, 1, {
      noBaseline: true,
      allowNoDelta: true,
    });
    const aviso = queue(root, ledger).notice;
    expect(aviso).not.toBeNull();
    expect(aviso!).toContain("T60a");
    expect(aviso!).toContain("open -> done");
    // A task parada não entra no aviso (era ela que inflava o digest).
    expect(aviso!).not.toContain("T60b");
    expect(aviso!.split("\n").length).toBeLessThanOrEqual(3);

    // run 3: nada mudou => silêncio.
    expect(queue(root, ledger).notice).toBeNull();
  });

  test("task bloqueada avisa e diz o motivo", () => {
    const root = mkRoot([{ task: "T60c", doneWhen: "false" }]);
    const ledger = join(root, "q.db");

    expect(queue(root, ledger).notice).toBeNull();
    verifyPlan(join(root, "tasks", "T60c", "PLAN.md"), ledger, 1, { noBaseline: true });

    const out = queue(root, ledger);
    expect(out.counts.blocked).toBe(1);
    expect(out.notice).not.toBeNull();
    expect(out.notice!).toContain("T60c");
    expect(out.notice!).toContain("blocked");
  });

  test("estados que avisam sao os que exigem acao nossa", () => {
    expect(NOTIFY_STATES).toEqual(
      expect.arrayContaining(["done", "blocked", "invalid_plan", "awaiting_receipt"]),
    );
    expect(NOTIFY_STATES).not.toContain("superseded");
    expect(NOTIFY_STATES).not.toContain("open");
    expect(NOTIFY_STATES).not.toContain("leased");
  });
});
