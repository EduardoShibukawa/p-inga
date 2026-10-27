---
mode: padrao
cobre: [W1, W2, W3, W4, W5]
goal: "Feedback do painel verdadeiro: sem sucesso falso, sem 'Em execução' sem processo, sem vazio confundido com filtro e sem erro engolido."
touch:
  - web/index.html
  - web/server.ts
cria: [tests/ux_t51_feedback.test.ts]
done_when: "bun test tests/ux_t51_feedback.test.ts"
---

# T51 — Dados honestos no painel

- W1: toda ação checa `res.ok`; erro HTTP vira mensagem com status e corpo, nunca "Exit undefined".
- W2: `/api/action/session` responde 501 "não implementado"; remover o ramo `success: true` stub.
- W3: sem spawn real não existe "Em execução": a resposta leva `simulated: true` e rótulo explícito.
- W4: fim dos `catch {}` silenciosos (`web/server.ts:62`) e dos `console.error` mudos do painel.
- W5: sem `ledger.db`, a UI diz "ledger ausente", mostra o caminho resolvido e `pinga verify <PLAN.md>`.
- Prova: teste sobe o servidor com cwd temporário e cobre 500, 501, comando inexistente e ledger ausente.
