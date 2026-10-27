import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPlan } from "../src/verify";

// T59 — task fechada antes do fix do verifier não é re-verificável: o `touch`
// dela não lista `src/verify.ts`/`src/receipt.ts`, então subir o verifier novo
// no worktree e rodar `verify` devolve `scope_drift` (medido em T54/T55/T56 em
// 2026-10-27) e o recibo `blocked` ainda revoga o `done` no ledger da fila.
//
// Contrato: `allowVerifierDrift` é opt-in e estreito — libera drift apenas nos
// arquivos do próprio verifier, deixando qualquer outro arquivo fora do `touch`
// como `scope_drift`. A liberação fica registrada no artefato do recibo
// (`allowed_drift: <path>`), para o recibo não esconder que houve escape.

const VERIFIER_ALVO = "src/verify.ts";

function mkRoot(): { root: string; planPath: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), "pinga-t59-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  mkdirSync(join(root, "tasks", "T59"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "verify.ts"), "export const versao = 1;\n");
  writeFileSync(join(root, "src", "outro.ts"), "export const outro = 1;\n");
  const planPath = join(root, "tasks", "T59", "PLAN.md");
  writeFileSync(
    planPath,
    [
      "---",
      "mode: mvp",
      "goal: reverificar task antiga sob verifier novo",
      'done_when: "true"',
      "touch:",
      "  - tasks/T59/PLAN.md",
      "---",
      "# T59",
      "",
    ].join("\n"),
  );
  Bun.spawnSync(["git", "add", "-A"], { cwd: root });
  Bun.spawnSync(
    ["git", "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-qm", "base"],
    { cwd: root },
  );
  const base = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root })
    .stdout.toString()
    .trim();
  // verifier mais novo por cima da base antiga da task
  writeFileSync(join(root, "src", "verify.ts"), "export const versao = 2;\n");
  return { root, planPath, base };
}

type Rec = { status: string; reason_code: string | null };

function runVerify(planPath: string, ledger: string, base: string, extra: Record<string, unknown> = {}) {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    verifyPlan(planPath, ledger, 1, {
      base,
      noBaseline: true,
      allowNoDelta: true,
      ...extra,
    } as unknown as Parameters<typeof verifyPlan>[3]);
  } finally {
    console.log = original;
  }
  const json = lines.reverse().find((l) => l.trim().startsWith("{"));
  if (json === undefined) throw new Error("verify não emitiu recibo");
  return JSON.parse(json) as Rec;
}

describe("T59 · reverificacao com verifier novo", () => {
  test("sem flag, verifier fora do touch continua sendo scope_drift", () => {
    const { root, planPath, base } = mkRoot();
    const rec = runVerify(planPath, join(root, "a.db"), base);
    expect(rec.status).toBe("blocked");
    expect(rec.reason_code).toBe("scope_drift");
  });

  test("allowVerifierDrift libera apenas arquivo do verifier e registra no artefato", () => {
    const { root, planPath, base } = mkRoot();
    const rec = runVerify(planPath, join(root, "b.db"), base, { allowVerifierDrift: true });
    expect(rec.reason_code).not.toBe("scope_drift");
    expect(rec.status).toBe("pass");

    const art = join(root, "runs", "T59", "1", "out.txt");
    expect(existsSync(art)).toBe(true);
    const out = readFileSync(art, "utf8");
    expect(out).toContain(`allowed_drift: ${VERIFIER_ALVO}`);
    expect(out).not.toContain("allowed_drift: src/outro.ts");
  });

  test("fora do verifier, a flag nao afrouxa o scope_drift", () => {
    const { root, planPath, base } = mkRoot();
    writeFileSync(join(root, "src", "outro.ts"), "export const outro = 2;\n");
    const rec = runVerify(planPath, join(root, "c.db"), base, { allowVerifierDrift: true });
    expect(rec.status).toBe("blocked");
    expect(rec.reason_code).toBe("scope_drift");
  });
});
