---
mode: padrao
goal: "Guardas I5 no pinga verify: base = --base ou último commit test(TNN): RED; tests_frozen alterado → blocked/tests_frozen_changed (exit 5); arquivo fora do touch → blocked/scope_drift (exit 6), sem rodar o done_when; pre-commit deixa passar RED e docs."
done_when: "bun test tests/guards.test.ts"
touch: ["src/guards.ts", "src/verify.ts", "src/cli.ts", "mise.toml"]
tests_frozen: ["tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 300000, minutes: 75 }
---
## Passos
- [ ] commit RED: tests/guards.test.ts com os casos de RED.md; PARE para revisão
- [ ] GREEN: src/guards.ts; verify.ts roda as guardas antes do done_when; cli ganha `--base` e `precommit`; mise.toml ganha pkl e pre-commit via `pinga precommit`
- [ ] commit GREEN com caminhos explícitos; mise run stable
- [ ] fechar task: .pinga/pinga-stable verify tasks/T04/PLAN.md
- [ ] preencher EVAL.md

## Dívidas conscientes
- touch por caminho exato (sem glob); EXEC.md/EVAL.md da própria task sempre liberados
- diff é base → árvore atual: reverificar task antiga depois de outras dá scope_drift
- pre-commit decide pelos caminhos staged (só tests/, tasks/, specs/ = RED/docs), não pela mensagem

## Fora
- disjuntor (T05), tokens (T06), EVAL gerado (T07)
- hk.pkl, src/plan.ts e src/receipt.ts não mudam
