---
mode: padrao
goal: "pinga eval <PLAN.md> [--ledger PATH] [--check]: gera tasks/<task>/EVAL.md a partir do ledger no template da SPEC §6 (status, tentativas, tempo, tokens, escopo), preservando parecer e bom/ruim/mudar do dono; --check só valida o schema, sem escrever."
done_when: "bun test tests/eval.test.ts"
touch: ["src/eval.ts", "src/cli.ts"]
tests_frozen: ["tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 350000, minutes: 90 }
---
## Passos
- [ ] commit RED: tests/eval.test.ts com os casos de RED.md; PARE para revisão
- [ ] GREEN: src/eval.ts (parse/validate/render/evalPlan, escopo via src/guards.ts); cli ganha `eval`
- [ ] commit GREEN com caminhos explícitos; mise run stable
- [ ] fechar task: .pinga/pinga-stable verify tasks/T07/PLAN.md
- [ ] preencher EVAL.md

## Dívidas conscientes
- tempo = soma de duration_ms dos recibos (arredonda pra cima), não relógio de parede
- --check não detecta EVAL.md desatualizado frente ao ledger
- parecer de outra família nasce "pendente" até o juiz (T08)

## Fora
- juiz automático (T08); EVAL.md de T00–T03 não são reescritos
- src/guards.ts, src/verify.ts e src/tokens.ts não mudam
