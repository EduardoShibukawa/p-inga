import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPlan } from "../src/verify";

// T58 — o vigia da fila emitiu 54 transições falsas num único run
// (2026-10-27 11:04:54: `T12: open -> done` … `T57: open -> done`) porque o
// snapshot `.pinga/queue-snapshot.json` guarda só `{task: estado}`, sem
// procedência: quando um run resolveu para um ledger vazio, ele gravou "open"
// para toda task e o run seguinte (ledger correto, tudo `done`) leu esse
// snapshot e anunciou a fila inteira como recém-concluída.
//
// Contrato: transição só é anunciada quando o estado anterior veio do MESMO
// ledger (mesma procedência). Snapshot de outro ledger é baseline recriado:
// nenhuma transição, e o digest diz isso em voz alta. Transição real (mesmo
// ledger, open -> done depois de recibo) continua sendo anunciada.

const PINGA = join(import.meta.dir, "..", "bin", "pinga.ts");
const REPO = join(import.meta.dir, "..");

function mkRoot(): { root: string; planPath: string } {
  const root = mkdtempSync(join(tmpdir(), "pinga-t58-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  mkdirSync(join(root, "tasks", "T58"), { recursive: true });
  const planPath = join(root, "tasks", "T58", "PLAN.md");
  writeFileSync(
    planPath,
    [
      "---",
      "mode: mvp",
      "goal: snapshot do vigia guarda procedencia do ledger",
      'done_when: "true"',
      "touch:",
      "  - tasks/T58/PLAN.md",
      "---",
      "# T58",
      "",
    ].join("\n"),
  );
  return { root, planPath };
}

type Run = {
  transitions: { task: string; from: string | null; to: string }[];
  counts: Record<string, number>;
};

function spawnQueue(root: string, ledger: string, extra: string[] = []) {
  const proc = Bun.spawnSync(
    [process.execPath, PINGA, "queue", ...extra, "--root", root, "--ledger", ledger],
    { cwd: REPO },
  );
  const out = proc.stdout.toString();
  const err = proc.stderr.toString();
  if (proc.exitCode !== 0) throw new Error(`queue exit ${proc.exitCode}: ${out}${err}`);
  return out;
}

function queue(root: string, ledger: string): Run {
  const out = spawnQueue(root, ledger, ["--json"]);
  const start = out.indexOf("{");
  if (start < 0) throw new Error(`queue sem JSON: ${out}`);
  return JSON.parse(out.slice(start)) as Run;
}

describe("T58 · snapshot sem procedencia forja transicao em massa", () => {
  test("snapshot gravado com outro ledger nao vira transicao", () => {
    const { root, planPath } = mkRoot();
    const ledgerDone = join(root, "done.db");
    const ledgerVazio = join(root, "vazio.db");

    verifyPlan(planPath, ledgerDone, 1, { noBaseline: true, allowNoDelta: true });

    // run 1: ledger vazio => tudo `open`, e o snapshot passa a dizer `open`.
    const antes = queue(root, ledgerVazio);
    expect(antes.counts.open).toBe(1);

    // run 2: ledger correto => `done`. Pela régua antiga isso virava
    // "open -> done" (fila inteira recém-concluída).
    const depois = queue(root, ledgerDone);
    expect(depois.counts.done).toBe(1);
    expect(depois.transitions).toHaveLength(0);

    const digest = spawnQueue(root, ledgerDone);
    expect(digest).not.toContain("open -> done");
    expect(digest.toLowerCase()).toContain("baseline");
  });

  test("mesmo ledger continua anunciando open -> done", () => {
    const { root, planPath } = mkRoot();
    const ledger = join(root, "q.db");

    expect(queue(root, ledger).counts.open).toBe(1);
    verifyPlan(planPath, ledger, 1, { noBaseline: true, allowNoDelta: true });

    const depois = queue(root, ledger);
    expect(depois.counts.done).toBe(1);
    expect(depois.transitions).toHaveLength(1);
    expect(depois.transitions[0]!.from).toBe("open");
    expect(depois.transitions[0]!.to).toBe("done");
  });
});
