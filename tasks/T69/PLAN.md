---
mode: mvp
goal: "Evento receipt usa receipt.check quando presente (receipt de PLAN emite check: plan)"
touch:
  - src/events.ts
  - tests/receipt_events_fix.test.ts
tests_frozen: ["tests/receipt_events_fix.test.ts"]
done_when: "bun test tests/receipt_events_fix.test.ts tests/receipt_events.test.ts tests/plan_verify.test.ts"
---
# T69: fix do judge (PLAN-0005-pinga-task-e-plan TASK-08-fix-check-plan)

Materializada de `.ginga/plans/PLAN-0005-pinga-task-e-plan/TASK-08-fix-check-plan.md`. Achado do Verifier Judge, severidade simples.
