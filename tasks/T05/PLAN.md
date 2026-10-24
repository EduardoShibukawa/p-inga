---
mode: padrao
goal: "Disjuntor automático (I3/Lei 3): falha do done_when ganha failure_signature (sha256 de exit + sha256 da saída + reason_code); se o recibo anterior da mesma task falhou com a mesma assinatura → blocked/breaker_same_failure, exit 4, escalar ao dono."
done_when: "bun test tests/breaker.test.ts"
touch: ["src/breaker.ts", "src/verify.ts"]
tests_frozen: ["tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 250000, minutes: 60 }
---
## Passos
- [ ] commit RED: tests/breaker.test.ts com os casos de RED.md; PARE para revisão
- [ ] GREEN: src/breaker.ts; verify.ts lê o último recibo da task antes de gravar e anexa `breaker` a toda falha do done_when (exit ≠ 0, sem timeout)
- [ ] commit GREEN com caminhos explícitos; mise run stable
- [ ] fechar task: .pinga/pinga-stable verify tasks/T05/PLAN.md
- [ ] preencher EVAL.md

## Dívidas conscientes
- timeout (budget), plan_invalid e guardas não armam o disjuntor
- fato novo = assinatura diferente; mudar o plano sem mudar a saída não rearma
- desarmar exige um recibo pass da task ou uma saída diferente

## Fora
- src/cli.ts não muda: o exit 4 sai pelo verifyPlan
- tokens (T06), EVAL gerado (T07)
