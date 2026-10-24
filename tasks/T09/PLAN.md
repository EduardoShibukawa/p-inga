---
mode: padrao
goal: "Roteador de modo monotônico (I12): mode_effective = max(modo do plano, sinais de touch ∪ diff → completo; trunk ou PINGA_MODE_NIGHT → padrao); só desce com --override-mode e --reason; todo recibo do verify grava mode_effective/mode_raised_by; pinga mode imprime a decisão."
done_when: "bun test tests/mode.test.ts"
touch: ["src/mode.ts", "src/verify.ts", "src/receipt.ts", "src/cli.ts"]
tests_frozen: ["tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 300000, minutes: 75 }
---
## Passos
- [x] commit RED: tests/mode.test.ts com os casos de RED.md; PARE para revisão
- [x] GREEN: src/mode.ts (regras, resolveMode, currentBranch, modePlan); receipt.ts valida mode_*
- [x] GREEN: verify.ts anexa a decisão a todo recibo de plano válido; completo + pass → awaiting_judge
- [x] commit GREEN com caminhos explícitos; mise run stable
- [x] fechar: pinga-stable verify, pinga-stable judge (juiz ≠ executor) e eval de tasks/T09/PLAN.md

## Dívidas conscientes
- sinais por glob de caminho: falso positivo sobe o modo (barato); sem análise de conteúdo
- touch exato (T04) entra como sinal; sem base, só touch, branch e noite contam
- completo só marca awaiting_judge; não bloqueia o accept (não existe accept ainda)

## Fora
- promoção mvp → completo (§5.3), spec BDD, prova no base (T11)
