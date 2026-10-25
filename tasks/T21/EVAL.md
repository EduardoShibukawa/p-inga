# EVAL T21 — Testes Provisionais (Scratchpad TDD) & Integração Gira-G

- **Task:** T21
- **Status:** PASS (exit 0)
- **Base RED:** `0ec372e` (exit 1)
- **Executor:** `opencode-go/beam-free` (Free Tier)
- **Arquivos modificados (`touch`):** `src/guards.ts`, `src/doctor.ts`, `src/cli.ts`
- **Resultados:**
  - `bun test tests/provisional.test.ts`: 6/6 pass (28 asserções).
  - Suíte completa: 200 pass, 0 fail (2432 asserções) em 29 arquivos.
  - Invariante I5 e I6 preservados: `isProvisionalTest` isenta testes de rascunho de `tests_frozen_changed` e `scope_drift`.
  - Ledger atualizado com recibo encadeado (seq 21, `ok 21`).
