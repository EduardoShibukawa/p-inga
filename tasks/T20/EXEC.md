# EXEC T20 — Modo Maestro com Hermes e Placar Adaptativo (D27..D32 / I26..I30)

- **Executor:** `gemini-3.8-flash` (`family: "gemini"`)
- **Base RED:** `b70eb9c` (`prove-red` `exit 0`)
- **Commit GREEN:** `707f25d`
- **Arquivos tocados (`touch`):** `src/maestro.ts` (novo), `src/cli.ts`
- **Testes congelados:** `tests/maestro.test.ts`, `tests/examples/T20.test.ts` (`11 pass`; suíte total `194 pass, 0 fail`)
- **Holdout:** 4 visíveis + 2 ocultos (`holdout ok`)
- **Juiz:** `qwen2.5-3b-instruct` (qwen) — `pass` (aprovou)
