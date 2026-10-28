---
mode: mvp
goal: "supersede sela receipt blocked/infra quando o wrapper sai 97"
touch:
  - src/supersede.ts
  - tests/exec_wrapper_fix2.test.ts
tests_frozen: ["tests/exec_wrapper_fix2.test.ts"]
done_when: "bun test tests/exec_wrapper_fix2.test.ts tests/exec_wrapper_fix.test.ts tests/exec_wrapper.test.ts tests/verify.test.ts tests/plan_verify.test.ts tests/queue.test.ts"
---
# T73: fix do supersede exit 97 (PLAN-0018-sandbox-done-when TASK-05)

Materializada de `.ginga/plans/PLAN-0018-sandbox-done-when/TASK-05-fix-supersede-exit97.md`.
