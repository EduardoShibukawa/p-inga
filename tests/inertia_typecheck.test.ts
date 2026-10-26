import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateInertia, type InertiaAction } from "../src/breaker";
import { preflightCheck } from "../src/typecheck";

describe("T23 — Disjuntor de Inércia (Invariante I6) & Pre-Flight Check", () => {
  test("1. evaluateInertia não desarma com menos de 3 leituras consecutivas", () => {
    const history: InertiaAction[] = [
      { type: "write", target: "src/engine.ts" },
      { type: "read", target: "src/engine.ts" },
      { type: "read", target: "src/types.ts" },
    ];
    const res = evaluateInertia(history);
    expect(res.tripped).toBe(false);
    expect(res.consecutiveReads).toBe(2);
    expect(res.warning).toBeUndefined();
  });

  test("2. evaluateInertia desarma exatamente ao atingir o limiar (3 leituras)", () => {
    const history: InertiaAction[] = [
      { type: "write", target: "src/engine.ts" },
      { type: "read", target: "src/engine.ts" },
      { type: "read", target: "src/engine.ts" },
      { type: "read", target: "src/engine.ts" },
    ];
    const res = evaluateInertia(history);
    expect(res.tripped).toBe(true);
    expect(res.consecutiveReads).toBe(3);
    expect(res.warning).toContain("Guardrail G1");
  });

  test("3. ação de escrita ou teste reseta o contador de inércia", () => {
    const history: InertiaAction[] = [
      { type: "read", target: "src/engine.ts" },
      { type: "read", target: "src/engine.ts" },
      { type: "test", target: "tests/engine.test.ts" },
      { type: "read", target: "src/engine.ts" },
    ];
    const res = evaluateInertia(history);
    expect(res.tripped).toBe(false);
    expect(res.consecutiveReads).toBe(1);
  });

  test("4. preflightCheck detecta código TypeScript válido com sucesso", () => {
    const tmp = join(tmpdir(), `pinga-test-preflight-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    const file = join(tmp, "valid.ts");
    writeFileSync(file, 'export const answer: number = 42;\nexport function getAnswer(): number { return answer; }\n');

    const res = preflightCheck(file, tmp);
    expect(res.ok).toBe(true);
    expect(res.toolUsed).toBe("bun");

    rmSync(tmp, { recursive: true, force: true });
  });

  test("5. preflightCheck detecta erro de sintaxe TypeScript", () => {
    const tmp = join(tmpdir(), `pinga-test-preflight-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    const file = join(tmp, "broken.ts");
    writeFileSync(file, 'export const answer = {\n'); // Chave aberta sem fechar

    const res = preflightCheck(file, tmp);
    expect(res.ok).toBe(false);
    expect(res.diagnostics).toBeDefined();
    expect(res.diagnostics).toContain("DIAGNÓSTICO ESTÁTICO");

    rmSync(tmp, { recursive: true, force: true });
  });
});
