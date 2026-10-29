---
mode: mvp
goal: "teste comportamental: holdout do verify com wrapper exit 97 vira receipt blocked/infra"
touch:
  - tests/exec_wrapper_holdout97.test.ts
tests_frozen: []
done_when: "bun test tests/exec_wrapper_holdout97.test.ts"
---
# T76: behavioral holdout exit 97 (PLAN-0021)
