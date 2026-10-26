import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NEW_FILE_GUARD_REASON,
  NEW_FILE_MAX_CHARS,
  NEW_FILE_MAX_LINES,
  PAYLOAD_GUARD_REASON,
  type InertiaAction,
  postToolInertiaHook,
  postToolTypeCheckHook,
  preToolPayloadGuard,
} from "../src/hooks";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function lines(count: number, prefix = "export const line"): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i} = ${i};`).join("\n");
}

describe("T24 — Guardrails baseados em Hooks", () => {
  test("1. preToolPayloadGuard bloqueia escrita monolítica > 100 linhas em arquivo existente", () => {
    const tmp = makeTempDir("pinga-hooks-guard-");
    try {
      writeFileSync(join(tmp, "existing.ts"), "export const short = 1;\n");

      const payload = lines(101);
      const res = preToolPayloadGuard(
        "write_file",
        { path: "existing.ts", content: payload },
        tmp
      );

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe(PAYLOAD_GUARD_REASON);
      expect(res.reason).toContain("Guardrail G2");
      expect(res.reason).toContain("gira write <file> <symbol>");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("1b. preToolPayloadGuard bloqueia payload de mais de 1500 caracteres em arquivo existente", () => {
    const tmp = makeTempDir("pinga-hooks-guard-chars-");
    try {
      writeFileSync(join(tmp, "existing.ts"), "export const short = 1;\n");

      const res = preToolPayloadGuard(
        "write_file",
        { path: "existing.ts", content: "x".repeat(1501) },
        tmp
      );

      expect(res.allowed).toBe(false);
      expect(res.reason).toBe(PAYLOAD_GUARD_REASON);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("2. preToolPayloadGuard permite criação de arquivo novo dentro do limite ou arquivos curtos <= 100 linhas", () => {
    const tmp = makeTempDir("pinga-hooks-allow-");
    try {
      // Arquivo novo dentro do limite (<= 120 linhas): permitido.
      expect(
        preToolPayloadGuard(
          "write_file",
          { path: "new.ts", content: lines(50) },
          tmp
        )
      ).toEqual({ allowed: true });

      // Arquivo novo que excede 120 linhas: bloqueado com instrução de esqueleto.
      const blockedNew = preToolPayloadGuard(
        "write_file",
        { path: "new.ts", content: lines(121) },
        tmp
      );
      expect(blockedNew.allowed).toBe(false);
      expect(blockedNew.reason).toBe(NEW_FILE_GUARD_REASON);
      expect(blockedNew.reason).toContain("limite de criação (120 linhas / 2500 caracteres)");
      expect(blockedNew.reason).toContain("append_file");
      expect(blockedNew.reason).toContain("gira add");

      // Arquivo novo que excede 2500 chars: bloqueado.
      const blockedNewChars = preToolPayloadGuard(
        "write_file",
        { path: "new2.ts", content: "x".repeat(2501) },
        tmp
      );
      expect(blockedNewChars.allowed).toBe(false);
      expect(blockedNewChars.reason).toBe(NEW_FILE_GUARD_REASON);

      // Arquivo existente com exatamente 100 linhas curtas: permitido.
      const exactly100Lines = Array.from({ length: 100 }, (_, i) => `x${i}`).join("\n");
      writeFileSync(join(tmp, "existing.ts"), "export const short = 1;\n");
      expect(
        preToolPayloadGuard(
          "write_file",
          { path: "existing.ts", content: exactly100Lines },
          tmp
        )
      ).toEqual({ allowed: true });

      // 100 linhas terminadas em newline continuam sendo 100 linhas.
      expect(
        preToolPayloadGuard(
          "write_file",
          { path: "existing.ts", content: `${exactly100Lines}\n` },
          tmp
        )
      ).toEqual({ allowed: true });

      // Ferramentas que não são write_file não passam pelo guard.
      expect(
        preToolPayloadGuard(
          "edit_file",
          { path: "existing.ts", content: lines(300) },
          tmp
        )
      ).toEqual({ allowed: true });

      // Sem conteúdo não há o que bloquear.
      expect(
        preToolPayloadGuard("write_file", { path: "existing.ts" }, tmp)
      ).toEqual({ allowed: true });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("3. postToolTypeCheckHook executa a checagem e anexa erros de sintaxe em arquivos TypeScript", async () => {
    const tmp = makeTempDir("pinga-hooks-typecheck-");
    try {
      writeFileSync(join(tmp, "broken.ts"), "export const answer = {\n");

      const broken = await postToolTypeCheckHook(
        "write_file",
        { path: "broken.ts" },
        tmp
      );
      expect(broken.ok).toBe(false);
      expect(broken.diagnostics).toBeDefined();
      expect(broken.diagnostics).toContain("DIAGNÓSTICO ESTÁTICO");

      // edit_file e append_file também disparam a checagem.
      const edited = await postToolTypeCheckHook(
        "edit_file",
        { path: "broken.ts" },
        tmp
      );
      expect(edited.ok).toBe(false);
      expect(edited.diagnostics).toContain("DIAGNÓSTICO ESTÁTICO");

      writeFileSync(
        join(tmp, "valid.ts"),
        "export const answer: number = 42;\nexport function getAnswer(): number { return answer; }\n"
      );
      expect(
        await postToolTypeCheckHook("append_file", { path: "valid.ts" }, tmp)
      ).toEqual({ ok: true });

      // gira_context só checa em ações de mutação.
      const giraWrite = await postToolTypeCheckHook(
        "gira_context",
        { action: "write", target: "broken.ts" },
        tmp
      );
      expect(giraWrite.ok).toBe(false);
      expect(giraWrite.diagnostics).toContain("DIAGNÓSTICO ESTÁTICO");

      expect(
        await postToolTypeCheckHook(
          "gira_context",
          { action: "read", target: "broken.ts" },
          tmp
        )
      ).toEqual({ ok: true });

      // Ferramentas de leitura não disparam checagem.
      expect(
        await postToolTypeCheckHook("read_file", { path: "broken.ts" }, tmp)
      ).toEqual({ ok: true });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("4. postToolInertiaHook desvia ao atingir 3 leituras consecutivas e reseta com mutação", () => {
    const history: InertiaAction[] = [];

    const first = postToolInertiaHook("read_file", { path: "src/a.ts" }, history);
    expect(first.tripped).toBe(false);
    expect(first.consecutiveReads).toBe(1);

    const second = postToolInertiaHook("list_files", {}, history);
    expect(second.tripped).toBe(false);
    expect(second.consecutiveReads).toBe(2);

    const third = postToolInertiaHook("search", { query: "foo" }, history);
    expect(third.tripped).toBe(true);
    expect(third.consecutiveReads).toBe(3);
    expect(third.warning).toContain("Guardrail G1");

    // Mutação reseta o contador.
    const afterWrite = postToolInertiaHook(
      "write_file",
      { path: "src/a.ts" },
      history
    );
    expect(afterWrite.tripped).toBe(false);
    expect(afterWrite.consecutiveReads).toBe(0);

    // Três novas leituras voltam a desviar; gira_context outline conta como leitura.
    postToolInertiaHook("gira_context", { action: "outline", target: "src/a.ts" }, history);
    postToolInertiaHook("gira_context", { action: "locate", target: "src/a.ts" }, history);
    const again = postToolInertiaHook(
      "check_syntax",
      { path: "src/a.ts" },
      history
    );
    expect(again.tripped).toBe(true);
    expect(again.consecutiveReads).toBe(3);

    // run_tests reseta o contador.
    const afterTest = postToolInertiaHook(
      "run_tests",
      { target: "tests/a.test.ts" },
      history
    );
    expect(afterTest.tripped).toBe(false);
    expect(afterTest.consecutiveReads).toBe(0);

    expect(history[0]).toEqual({ type: "read", target: "src/a.ts" });
    expect(history[history.length - 1]).toEqual({
      type: "test",
      target: "tests/a.test.ts",
    });
  });

  test("5. postToolInertiaHook: run_python, gira_context(impact) e mutação com success=false", () => {
    const history: InertiaAction[] = [];

    // gira_context(impact) é mapeado para read
    const act1 = postToolInertiaHook(
      "gira_context",
      { action: "impact", target: "src/a.ts" },
      history
    );
    expect(act1.tripped).toBe(false);
    expect(act1.consecutiveReads).toBe(1);

    // Segunda leitura
    const act2 = postToolInertiaHook("read_file", { path: "src/b.ts" }, history);
    expect(act2.consecutiveReads).toBe(2);

    // Mutação com falha (success: false): NÃO zera inércia!
    const failedWrite = postToolInertiaHook(
      "write_file",
      { path: "src/c.ts" },
      history,
      false
    );
    expect(failedWrite.consecutiveReads).toBe(2);
    expect(failedWrite.tripped).toBe(false);

    // Terceira leitura: atinge o limiar e desarma (3 leituras consecutivas)
    const act3 = postToolInertiaHook("read_file", { path: "src/d.ts" }, history);
    expect(act3.consecutiveReads).toBe(3);
    expect(act3.tripped).toBe(true);

    // Outra mutação com falha: continua desarmado!
    const failedWrite2 = postToolInertiaHook(
      "edit_file",
      { path: "src/c.ts" },
      history,
      false
    );
    expect(failedWrite2.consecutiveReads).toBe(3);
    expect(failedWrite2.tripped).toBe(true);

    // run_python conta como teste e reseta inércia
    const afterPython = postToolInertiaHook(
      "run_python",
      { script: "test.py" },
      history
    );
    expect(afterPython.consecutiveReads).toBe(0);
    expect(afterPython.tripped).toBe(false);
  });
});
