import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runPinga, tmp } from "./helpers/home.ts";

const HELPER = readFileSync(join(import.meta.dir, "helpers/home.ts"), "utf8");

/**
 * Defeito pré-existente em main (0899228 e 0825bf5): `runPinga` monta o env do
 * filho a partir do env recebido, apaga XDG_CONFIG_HOME/XDG_DATA_HOME/
 * PI_CODING_AGENT_DIR e **não** propaga PATH. Quem chama com env mínimo
 * (HOME/XDG_STATE_HOME/TMPDIR) recebe, no lugar de um exit code, a exceção
 * `error: Executable not found in $PATH: "bun"` vinda do Bun.spawnSync.
 * A suíte esconde isso porque `makeRealisticHome` injeta PATH (home.ts:119).
 */
describe("T55 · helper de teste herda PATH", () => {
  test("env mínimo não derruba a chamada", () => {
    const td = tmp("t55-nopath-");
    const env = { HOME: td, XDG_STATE_HOME: td, TMPDIR: td } as Record<string, string>;

    // `queue --json` é determinístico com ledger temporário e sempre emite JSON.
    // `--version` não existe na CLI: media "comando desconhecido" (exit 2), e
    // `tdd list` sai 0 com stdout vazio sob HOME sandbox — nenhum dos dois prova
    // que o binário executou. `queue` prova.
    const args = ["queue", "--json", "--ledger", join(td, "q.db")];
    expect(() => runPinga(args, env)).not.toThrow();

    const res = runPinga(args, env);
    expect(res.exit).toBe(0);
    expect(res.stdout.trim().startsWith("{")).toBe(true);
    expect(res.stderr).toBe("");
  });

  test("PATH herdado é injetado sem sobrescrever PATH explícito", () => {
    expect(HELPER).toMatch(/childEnv\.PATH/);

    const td = tmp("t55-explicit-");
    const explícito: Record<string, string> = {
      HOME: td,
      XDG_STATE_HOME: td,
      TMPDIR: td,
      PATH: process.env.PATH ?? "",
    };
    const res = runPinga(["queue", "--json", "--ledger", join(td, "q.db")], explícito);
    expect(res.exit).toBe(0);
    expect(res.stdout.trim().startsWith("{")).toBe(true);
  });

  test("as chaves de sandbox continuam removidas", () => {
    expect(HELPER).toMatch(/delete childEnv\.XDG_CONFIG_HOME/);
    expect(HELPER).toMatch(/delete childEnv\.XDG_DATA_HOME/);
    expect(HELPER).toMatch(/delete childEnv\.PI_CODING_AGENT_DIR/);
  });
});
