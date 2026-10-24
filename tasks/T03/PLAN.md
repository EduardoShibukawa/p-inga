---
mode: padrao
goal: "pinga verify <PLAN.md>: lint do plano, roda o done_when, grava recibo no ledger e devolve exit pelo status; mais o build do pinga-stable."
done_when: "bun test tests/verify.test.ts"
touch: ["src/plan.ts", "src/verify.ts", "src/cli.ts", "scripts/stable.ts", "mise.toml"]
tests_frozen: ["tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 350000, minutes: 90 }
---
## Passos
- [ ] commit RED: tests/verify.test.ts com os casos de RED.md; PARE para revisão
- [ ] GREEN: plan.ts, verify.ts, subcomando verify, scripts/stable.ts, task mise `stable`
- [ ] commit GREEN; `mise run stable`
- [ ] recibos retroativos: .pinga/pinga-stable verify tasks/T0N/PLAN.md, N=0..3
- [ ] preencher EVAL.md

## Dívidas conscientes
- tokens null e cost_evidence "not run" até a T06
- touch e tests_frozen só são lidos, não aplicados (T04)

## Fora
- disjuntor automático (T05), juiz (T08)
