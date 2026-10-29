---
mode: padrao
goal: "O pinga remove install/adopt/adapters, os comandos apontam para ginga install e nada em src/bin/web cita pi-harness"
done_when: "bun test && ! rg -n 'pi-harness' src bin web"
touch: ["tasks/T78/PLAN.md", "src/cli.ts", "src/doctor.ts", "src/install.ts", "src/adopt.ts", "src/shadow.ts", "src/adapters/claude.ts", "src/adapters/hermes.ts", "src/adapters/opencode.ts", "src/adapters/pi.ts", "src/adapters/tuios.ts", "tests/adapters.test.ts", "tests/adopt.test.ts", "tests/install.test.ts", "tests/install_rebaseline.test.ts", "tests/hermes_enable_config.test.ts", "tests/hermes_local_source.test.ts", "tests/opencode_probe.test.ts", "tests/tuios_targets.test.ts", "tests/examples/T18.test.ts", "tests/helpers/stubs.ts", "tests/doctor.test.ts", "tests/install_moved.test.ts", "README.md", "AGENTS.md"]
tests_frozen: []
---

## Contexto
- install/adopt/adapters moram no `ginga install` (PLAN-0006/0026); apagar módulos e testes; `pinga install|adopt` → exit 2 com "movido para `ginga install`".
- `pinga doctor` fica só com manifest/integrity + llm/models (seção de adapters fora); `--only` aceita só `manifest|llm`; `checkGiraStatus` fica como está.
- `manifest.ts` fica (usado por lessons/doctor/cli); `shadow.ts` só era usado por install.ts → apagar.
- RED: sem `tests_frozen`; o `done_when` falha na base por `rg 'pi-harness'` (54 hits).
