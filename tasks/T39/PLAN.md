---
mode: padrao
cobre: [T1, T2, T3, D1, D2, D3, D4, D5]
goal: "Fazer CLI e docs dizerem a verdade: alvo inválido vira erro de uma linha, usage enxuto, painel abrível em um comando e doc sem caminho fantasma."
touch:
  - src/cli.ts
  - package.json
  - README.md
  - docs/guides/quickstart.md
  - docs/concepts/ledger.md
  - docs/concepts/invariants.md
  - docs/intro.md
cria: [docs/appendix/discord.md, tests/ux_t39_cli_docs.test.ts]
done_when: "bun test tests/ux_t39_cli_docs.test.ts"
---
# T39 — CLI e docs acionáveis
- T1: `docs eval` valida que o alvo é arquivo antes de `readFileSync`; diretório vira erro com dica, sem stack.
- T2: comando desconhecido imprime o token + 2-3 linhas de uso, não o USAGE inteiro (`src/cli.ts:1268`).
- T3: `pinga web` no usage e implementado (`"web"` no `package.json`), porta 4242, uma linha na doc.
- D1: `.pinga/pinga-stable` sai dos 4 pontos (quickstart 16/32/49, ledger 55) e entra o comando real.
- D2: I20 e o nó DISCORD vão para `docs/appendix/discord.md`; doc ativa sem promessa de mensageria.
- D3: modos da doc passam a vir de `src/mode.ts` (mvp/padrao/completo); teste importa a lista.
- D4/D5: README do estado atual (caminho existente, versão do `package.json`, detalhe em `docs/`), link do intro normalizado e checador de link interno que falha em página ausente.
- Prova: teste roda `bin/pinga.ts` como subprocesso e lê `docs/` asserindo caminhos, modos e ausências.
