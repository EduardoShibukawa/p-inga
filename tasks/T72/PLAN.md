---
mode: mvp
goal: "holdout passa pelo wrapper e prove/plan_verify/supersede são fail-closed (exit 97 = infra com precedência)"
touch:
  - src/examples.ts
  - src/prove.ts
  - src/plan_verify.ts
  - src/supersede.ts
  - tests/exec_wrapper_fix.test.ts
tests_frozen: ["tests/exec_wrapper_fix.test.ts"]
done_when: "bun test tests/exec_wrapper_fix.test.ts tests/exec_wrapper.test.ts tests/verify.test.ts tests/plan_verify.test.ts tests/queue.test.ts"
---
# T72: fix do holdout e fail-closed (PLAN-0018-sandbox-done-when TASK-04)

Materializada de `.ginga/plans/PLAN-0018-sandbox-done-when/TASK-04-fix-holdout-e-fail-closed.md`.
