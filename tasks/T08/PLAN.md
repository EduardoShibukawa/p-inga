---
mode: padrao
goal: "Juiz de família distinta (I10/I11): modelFamily, atestado do modelo servido via GET /v1/models (e transcript do executor), pinga judge grava recibo flow judge com verified_by e model_attested; mesma família → blocked/same_family_judge (exit 7) sem chamar o modelo."
done_when: "bun test tests/judge.test.ts"
touch: ["src/family.ts", "src/judge.ts", "src/receipt.ts", "src/breaker.ts", "src/eval.ts", "src/cli.ts", "bin/pinga.ts"]
tests_frozen: ["tests/judge.test.ts", "tests/receipt.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/repo.test.ts"]
budget: { tokens: 400000, minutes: 90 }
---
## Passos
- [ ] commit RED: tests/judge.test.ts + REASON_CODES novos em tests/receipt.test.ts; PARE para revisão
- [ ] GREEN: family.ts (modelFamily, attest*), judge.ts (judgePlan async), receipt.ts (campos, receiptKind)
- [ ] GREEN: breaker/eval filtram receiptKind verify; eval tira parecer do juiz; cli/bin aceitam Promise
- [ ] commit GREEN com caminhos explícitos; mise run stable
- [ ] fechar: pinga-stable verify tasks/T08/PLAN.md; juiz desta task = dono (D10); EVAL.md

## Dívidas conscientes
- um juiz só, por flag/env; sem pool, cota nem fallback de família
- diff do juiz = git diff da base, sem untracked, cortado em PINGA_JUDGE_MAX_DIFF_BYTES
- veredito de um modelo pequeno: só rebaixa (I1′), não calibrado com bugs plantados

## Fora
- seleção de juiz por cota, Codex/agy, calibração (v0.2); verify.ts não muda
