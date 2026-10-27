---
mode: padrao
goal: "AGENTS.md ganha a secao Queue & Executor Protocol (claim/require-delta/release, main read-only, um RED por vez, runs/ gitignored) e GEMINI.md aponta para ela, para que agente externo nao escreva na main em paralelo"
done_when: "bun test tests/docs_governance.test.ts"
tests_frozen: ["tests/docs_governance.test.ts"]
touch:
  - AGENTS.md
  - GEMINI.md
---

## Context

- Hoje `AGENTS.md`/`CLAUDE.md` so mandam fazer contrato + `prove-red` + `verify`. O protocolo da fila
  (`queue --claim`, `--require-delta`, `queue --release`) existe apenas na skill do profile Hermes.
- Claude Code, Codex, OpenCode, Gemini e Pi leem `AGENTS.md`/`CLAUDE.md`/`GEMINI.md`; sem a secao eles
  fazem o ciclo formal e escrevem direto na `main`, colidindo com o executor.
- Implementacao: uma secao curta em `AGENTS.md` (ingles, como o resto do arquivo) e um `GEMINI.md`
  novo que delega a ela. Nenhum codigo de runtime muda.
- O teste congela a prosa: apagar a secao ou o `GEMINI.md` quebra a suite (gate de regressao).
- Fora de escopo: `AGENTS.md` da raiz de `duh-homelab` (nao e repo git, nao passa pelo ledger).
