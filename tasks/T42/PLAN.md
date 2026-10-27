---
mode: mvp
goal: "Tentativas e disjuntor escopados por repo+task no ledger global"
touch:
  - src/receipt.ts
  - src/breaker.ts
  - src/verify.ts
  - src/prove.ts
done_when: "bun test tests/ledger_scope.test.ts tests/breaker.test.ts tests/receipt.test.ts"
tests_frozen: ["tests/ledger_scope.test.ts"]
---
# T42: escopo de repositório no ledger

Recibos só têm `task`; T01 de p-inga e gira-g colidem em attempts/disjuntor.
Escopo: campo opcional `repo` = realpath de `git rev-parse --git-common-dir`
(estável entre worktrees do mesmo repo; independe de remote).
Recibos legados (sem `repo`) seguem válidos e não contam para nenhum escopo.
Placar do Maestro usa `attempts` do recibo, logo herda a correção.
