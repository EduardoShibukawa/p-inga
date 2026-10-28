---
mode: mvp
goal: "Evento receipt do pinga usa id ULID e omite campos null, passando no validador v1"
touch:
  - src/events.ts
  - tests/receipt_events_v1.test.ts
  - tests/receipt_events.test.ts
tests_frozen: ["tests/receipt_events_v1.test.ts", "tests/receipt_events.test.ts"]
done_when: "bun test tests/receipt_events_v1.test.ts tests/receipt_events.test.ts tests/receipt_events_fix.test.ts"
---
# T70: fix do judge, rodada 2 (PLAN-0005-pinga-task-e-plan TASK-09-fix-evento-v1)

Materializada de `.ginga/plans/PLAN-0005-pinga-task-e-plan/TASK-09-fix-evento-v1.md`.
