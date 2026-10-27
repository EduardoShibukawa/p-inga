---
mode: padrao
goal: "A fila trata recibo flow=prove_red como prova de RED, não como conclusão: task com RED provado e nada mais fica open/blocked, e só verify/judge com pass fecham task"
touch:
  - src/queue.ts
done_when: "bun test tests/queue_state_prove_red.test.ts"
tests_frozen: ["tests/queue_state_prove_red.test.ts"]
---
# T56: recibo de RED não conclui task

`prove-red` emite `status: pass` quando prova que o contrato REPROVA no base. A fila
(`latestReceipt`/`hasPassReceipt` em src/queue.ts) lê status sem olhar `flow`, então toda
task enfileirada com o RED já provado nasce `done` e nunca é reexecutada — a fila se
esvazia sozinha (medido: T54 e T55 apareceram `done` logo após o `prove-red`).
