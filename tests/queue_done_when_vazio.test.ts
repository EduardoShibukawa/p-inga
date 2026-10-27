import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPlan } from "../src/verify";

// T57 — `verify` sela `pass` quando o done_when executa ZERO testes.
//
// Medido na fila: recibos 127/129 gravaram `T54 pass` / `T55 pass` com
// "done_when exit 0 em 0s" e `runs/T54/2/out.txt` de 0 byte, porque o arquivo
// de teste ainda não existia na base. Laboratório: `bun test ./tests/x.test.ts`
// sobre um arquivo sem nenhum `test()` imprime " 0 pass / 0 fail / Ran 0 tests"
// e sai com código 0 — verde falso.
//
// Contrato: quando o done_when invoca um runner de teste (`bun test`), o recibo
// só pode ser `pass` se a saída comprovar execução de pelo menos 1 teste.
// Comando que não é runner (ex.: `true`, `go build ./...`) continua passando.

type Rec = {
  status: string;
  reason_code: string | null;
  summary: string;
};

function mkPlan(doneWhen: string, tests?: { name: string; body: string }) {
  const root = mkdtempSync(join(tmpdir(), "pinga-t57-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: root });
  mkdirSync(join(root, "tasks", "T57"), { recursive: true });
  mkdirSync(join(root, "tests"), { recursive: true });
  if (tests) writeFileSync(join(root, "tests", tests.name), tests.body);
  const planPath = join(root, "tasks", "T57", "PLAN.md");
  writeFileSync(
    planPath,
    [
      "---",
      "mode: mvp",
      "goal: verify não sela pass sem teste executado",
      `done_when: "${doneWhen}"`,
      "touch:",
      "  - src/verify.ts",
      "---",
      "# T57",
      "",
    ].join("\n"),
  );
  return { planPath, ledger: join(root, "q.db") };
}

function runVerify(planPath: string, ledger: string): Rec {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    verifyPlan(planPath, ledger, 1, { noBaseline: true, allowNoDelta: true });
  } finally {
    console.log = original;
  }
  const json = lines.reverse().find((l) => l.trim().startsWith("{"));
  if (json === undefined) throw new Error("verify não emitiu recibo");
  return JSON.parse(json) as Rec;
}

describe("T57 · verify exige teste executado", () => {
  test("arquivo de teste com 0 casos não sela pass (exit 0 enganoso)", () => {
    const { planPath, ledger } = mkPlan("bun test ./tests/vazio.test.ts", {
      name: "vazio.test.ts",
      body: "// nenhum test() aqui: bun sai 0 com 'Ran 0 tests'\n",
    });
    const rec = runVerify(planPath, ledger);
    expect(rec.status).toBe("blocked");
    expect(rec.reason_code).toBe("no_tests_run");
  });

  test("runner ausente (filtro que não casa arquivo) não sela pass", () => {
    const { planPath, ledger } = mkPlan("bun test ./tests/nao_existe.test.ts");
    const rec = runVerify(planPath, ledger);
    expect(rec.status).toBe("blocked");
    expect(rec.reason_code).toBe("no_tests_run");
  });

  test("teste que realmente roda continua selando pass", () => {
    const { planPath, ledger } = mkPlan("bun test ./tests/ok.test.ts", {
      name: "ok.test.ts",
      body:
        'import { expect, test } from "bun:test";\n' +
        'test("verdade", () => { expect(1 + 1).toBe(2); });\n',
    });
    const rec = runVerify(planPath, ledger);
    expect(rec.status).toBe("pass");
    expect(rec.reason_code).toBeNull();
  });

  test("done_when que não é runner de teste não é afetado", () => {
    const { planPath, ledger } = mkPlan("true");
    const rec = runVerify(planPath, ledger);
    expect(rec.status).toBe("pass");
  });
});
