---
mode: mvp
goal: "O servidor do painel usa o hub de SSE de web/sse.ts em vez de manter um conjunto de controllers próprio; nenhum export do módulo fica órfão"
touch:
  - web/server.ts
done_when: "bun test tests/ux_t54_sse_modulo.test.ts"
tests_frozen: ["tests/ux_t54_sse_modulo.test.ts"]
---
# T54: hub de SSE único

main (T41) extraiu o hub para `web/sse.ts`; o ciclo UX reescreveu `web/server.ts` com um
`Set` de controllers interno. Hoje `web/sse.ts` é código morto com teste verde — prova
nada sobre o servidor que roda. Migrar o servidor para o módulo, manter o contrato do
módulo (add/remove/close/notify/count) e não deixar export órfão.
