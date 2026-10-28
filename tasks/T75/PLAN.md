---
mode: mvp
goal: "exit 97 no holdout do verify e no prove grava blocked/infra, não overfit_holdout nem not run"
touch:
  - src/verify.ts
  - src/prove.ts
  - tests/exec_wrapper_fix3.test.ts
tests_frozen: ["tests/exec_wrapper_fix3.test.ts"]
done_when: "bun test tests/exec_wrapper_fix3.test.ts tests/exec_wrapper_fix2.test.ts tests/exec_wrapper_fix.test.ts tests/exec_wrapper.test.ts tests/verify.test.ts tests/prove.test.ts tests/plan_verify.test.ts"
---
# T75: fix do judge, rodada 3 (PLAN-0018 TASK-07-fix-holdout-e-prove-exit97)

Materializada de `.ginga/plans/PLAN-0018-sandbox-done-when/TASK-07-fix-holdout-e-prove-exit97.md`.
