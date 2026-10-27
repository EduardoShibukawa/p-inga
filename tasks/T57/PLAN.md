---
mode: padrao
goal: "verify não sela pass quando o done_when executa zero testes: recibo vira blocked/no_tests_run se a saída de um runner (bun test) não comprovar ao menos 1 teste executado, e comandos que não são runner seguem passando"
touch:
  - src/verify.ts
  - src/receipt.ts
done_when: "bun test tests/queue_done_when_vazio.test.ts"
tests_frozen: ["tests/queue_done_when_vazio.test.ts"]
---
# T57: `pass` vazio — verify aceita done_when que rodou 0 testes

Recibos 127/129 gravaram `T54 pass` e `T55 pass` com "done_when exit 0 em 0s" e
`runs/T54/2/out.txt` de **0 byte**, quando o arquivo de teste ainda não existia no
base. A fila leu `pass`, marcou `done` e a task auto-satisfeita nunca foi executada.

Reprodução mínima: `bun test ./tests/x.test.ts` sobre arquivo sem nenhum `test()`
imprime ` 0 pass / 0 fail / Ran 0 tests` e sai com **exit 0**.

Correção: em `src/verify.ts`, depois do `done_when`, quando o comando invoca
`bun test`, exigir na saída a comprovação de ≥1 teste executado (linha
`N pass` com N ≥ 1 ou `Ran N tests` com N ≥ 1, e nenhum ` 0 fail`); caso
contrário gravar `blocked` + `reason_code: no_tests_run` (novo código em
`src/receipt.ts`). Comandos que não são runner ficam intactos.
