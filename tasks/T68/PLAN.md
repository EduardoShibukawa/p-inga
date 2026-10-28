---
mode: mvp
goal: "Todo receipt selado no ledger também vira um evento receipt v1 em $GINGA_EVENTS, sem efeito quando a variável não existe"
done_when: "bun test tests/receipt_events.test.ts tests/ledger.test.ts"
tests_frozen: ["tests/receipt_events.test.ts"]
touch: ["src/events.ts", "src/ledger.ts", "tests/receipt_events.test.ts"]
---

## Context

- Materializada de `plans/PLAN-0005-pinga-task-e-plan/TASK-07-receipt-events.md` (passada RED do Planner).
- Repo-alvo: p-inga. tests_frozen escritos pelo Planner; o Executor não os toca.
