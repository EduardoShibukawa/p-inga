---
mode: mvp
goal: "Fechar cliente SSE já fechado é idempotente e silencioso; cliente sai dos inscritos uma vez"
touch:
  - web/sse.ts
  - web/server.ts
  - tests/web_sse.test.ts
done_when: "bun test tests/web_sse.test.ts"
tests_frozen: ["tests/web_sse.test.ts"]
---
# T41: close SSE idempotente

Visto na p-inga-ux: `falha ao fechar cliente SSE: Invalid state: Controller is
already closed`. No main, `cancel(controller)` recebe o reason (não o controller),
então o cliente desconectado nunca sai do Set. Extrai o registro SSE para
`web/sse.ts` (add/remove/close/closeAll/notify) com close idempotente (guarda
`closed`, sem console.error) e `server.ts` passa a usá-lo.
