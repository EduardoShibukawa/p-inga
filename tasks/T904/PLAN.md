---
mode: padrao
goal: "pinga com --root na pasta de um pacote de monorepo: receipt por pacote, sem colisão de T<N> entre pacotes, sem fuga de escopo por mudança em outro pacote, e receipts do repo separado continuam valendo"
done_when: "bun test tests/monorepo_pacote.test.ts tests/guards.test.ts tests/gate_cli.test.ts tests/queue_pinga_task.test.ts"
touch:
  - src/breaker.ts
  - src/queue.ts
  - src/guards.ts
  - src/prove.ts
  - tests/monorepo_pacote.test.ts
  - tasks/T904/PLAN.md
tests_frozen:
  - tests/monorepo_pacote.test.ts
---

## Contexto (PLAN-0003, AC-1 a AC-3)
- Hoje `--root` tem que ser a raiz de um repo git e o escopo do receipt é o diretório git comum. Num monorepo isso é um escopo só para todos os pacotes, e o mesmo `T<N>` existe em vários.
- Escopo do pacote: `<git common dir>#<pasta>`. Na raiz do repositório nada muda.
- Receipt antigo vale para o pacote quando foi gravado com o `.git` de uma pasta de mesmo nome (`…/<pasta>/.git`).
- A busca do commit `test(T<N>): RED` e a lista de arquivos alterados ficam restritas à pasta do pacote; na raiz do repositório continuam como antes (inclusive RED em commit vazio).
- A prova do RED faz o checkout do base do repositório inteiro e roda o `done_when` na pasta do pacote dentro dele.
