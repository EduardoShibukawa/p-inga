---
mode: mvp
goal: "adapter hermes: fonte local vira symlink <shadow>/.hermes/plugins/pi-harness -> <source>/hermes-plugin em vez de hermes plugins install"
touch:
  - src/adapters/hermes.ts
  - tests/helpers/stubs.ts
done_when: "bun test tests/hermes_local_source.test.ts"
tests_frozen: ["tests/hermes_local_source.test.ts"]
---
# T44: hermes com fonte local

`hermes plugins install <id>` só aceita catálogo, Git URL ou owner/repo; um
caminho absoluto vira https://github.com/home/<user>.git e o install falha.
Se ctx.source existe no disco: cria (idempotente) o symlink
<shadow>/.hermes/plugins/pi-harness -> <source>/hermes-plugin; symlink para
outro alvo = erro claro "aponta para". Depois segue o enable existente.
Fontes Git/catálogo continuam em `hermes plugins install`. O caminho já é
target do adapter (HERMES_PLUGIN_DIR), então entra no manifesto/integrity.
RED = teste com shadow temporário e hermes falso: install sai 1 no base.
