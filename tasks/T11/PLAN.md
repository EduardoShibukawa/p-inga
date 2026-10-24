---
mode: padrao
goal: "Prova no base (I15): pinga prove-red roda o done_when (e o holdout) numa git worktree temporária no commit RED ou --base; passou no base → blocked/test_passed_on_base (exit 10); exit 126/127/timeout → not run/infra; worktree sempre removida; automática no verify em completo."
done_when: "bun test tests/prove.test.ts"
touch: ["src/prove.ts", "src/verify.ts", "src/receipt.ts", "src/examples.ts", "src/cli.ts"]
tests_frozen: ["tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 350000, minutes: 90 }
---
## Passos
- [x] commit RED: tests/prove.test.ts + test_passed_on_base em tests/receipt.test.ts; PARE para revisão
- [x] GREEN: src/prove.ts (classify, worktree temporária, overlay, sweep, provePlan); cli ganha `prove-red`
- [x] GREEN: verify prova antes do done_when em completo ou --prove-base; runHoldout ganha cwd; base_ref no recibo
- [x] commit GREEN com caminhos explícitos; mise run stable; provas retroativas T08–T11 (AC-P)
- [x] fechar: pinga-stable verify, pinga-stable judge e eval de tasks/T11/PLAN.md

## Dívidas conscientes
- falhar no base não prova que o teste é forte (sem mutação); só que não é vazio
- worktree limpa não tem node_modules/.m2: repo com dependências tende a dar infra
- completo sem commit RED pula a prova com aviso (mantém o T09 verde)

## Fora
- mutação (Stryker/PIT), promoção mvp → completo, accept
