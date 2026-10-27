import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * T61: um agente externo (Claude Code, Codex, OpenCode, Gemini, Pi) abre a sessão
 * lendo AGENTS.md/CLAUDE.md. Se o protocolo da fila não estiver escrito lá, ele
 * escreve direto na `main` em paralelo com o executor. Este teste torna a prosa um
 * gate: apagar a seção quebra a suíte.
 */
describe("T61 · protocolo da fila visível para agentes externos", () => {
  const agents = () => read("AGENTS.md");

  test("AGENTS.md tem a seção Queue & Executor Protocol", () => {
    expect(agents()).toContain("Queue & Executor Protocol");
  });

  test("a seção cita o ciclo claim → verify --require-delta → release", () => {
    const a = agents();
    expect(a).toContain("pinga queue --claim");
    expect(a).toContain("--require-delta");
    expect(a).toContain("pinga queue --release <T>");
  });

  test("a seção diz que a raiz publicada é somente leitura e que há um RED por vez", () => {
    const a = agents();
    expect(a).toMatch(/read-only/i);
    expect(a).toMatch(/p-inga-exec|worktree/i);
    expect(a).toContain("one RED at a time");
  });

  test("a seção avisa que runs/ é gitignored (artefato não vai para o commit)", () => {
    expect(agents()).toMatch(/runs\/?.{0,80}gitignored/is);
  });

  test("GEMINI.md existe e aponta para AGENTS.md", () => {
    expect(existsSync(join(root, "GEMINI.md"))).toBe(true);
    expect(read("GEMINI.md")).toContain("AGENTS.md");
  });
});
