---
mode: mvp
goal: "adapter hermes: fonte local habilita pi-harness editando plugins.enabled do config.yaml da shadow, sem chamar o CLI hermes"
touch:
  - src/adapters/hermes.ts
  - tests/hermes_local_source.test.ts
  - tests/hermes_enable_config.test.ts
  - tests/adapters.test.ts
  - tasks/T45/PLAN.md
done_when: "bun test tests/hermes_enable_config.test.ts tests/hermes_local_source.test.ts"
tests_frozen: ["tests/hermes_enable_config.test.ts"]
---
# T45: enable via config.yaml para fonte local

`hermes plugins enable` com HOME=shadow faz bootstrap completo (cache,
installs, logs, SOUL.md, .local/bin...) e o dry-run sai 11 com milhares de
"fora dos alvos". Para fonte local: após o symlink, garantir `pi-harness`
em `plugins.enabled` de <shadow>/.hermes/config.yaml (lista em bloco, como
no config real), preservando o resto, sem duplicar, idempotente. Cria o
arquivo/chaves se ausentes. Fontes Git/catálogo seguem com o CLI.
Única mudança fora do append declarado (/plugins/enabled): nenhuma.
T44 test e timeout de adapters.test (stub hermes->tuios) ajustados.
RED = hermes falso que sai 1 em `plugins enable`; apply local lança no base.
