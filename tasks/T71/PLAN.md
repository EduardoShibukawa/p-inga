---
mode: mvp
goal: "done_when roda via PINGA_EXEC_WRAPPER (fail-closed) em verify, prove, plan_verify e supersede"
touch:
  - src/exec.ts
  - src/verify.ts
  - src/prove.ts
  - src/plan_verify.ts
  - src/supersede.ts
  - tests/exec_wrapper.test.ts
tests_frozen: ["tests/exec_wrapper.test.ts"]
done_when: "bun test tests/exec_wrapper.test.ts tests/verify.test.ts tests/plan_verify.test.ts tests/queue.test.ts tests/receipt_events_v1.test.ts"
---
# T71: wrapper de execução do done_when (PLAN-0018-sandbox-done-when TASK-01)

Materializada de `.ginga/plans/PLAN-0018-sandbox-done-when/TASK-01-exec-wrapper.md`.
