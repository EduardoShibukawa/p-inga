---
mode: padrao
goal: "Examples sem LLM (I13/I14): pinga examples --from <arquivo fora do repo> parte os exemplos por sha256 em visível/holdout, gera tests/examples/<task>.test.ts e guarda o holdout em PINGA_HOLDOUT_DIR; no verify, visíveis passam e holdout falha → fail/overfit_holdout (exit 9)."
done_when: "bun test tests/examples.test.ts"
touch: ["src/examples.ts", "src/verify.ts", "src/receipt.ts", "src/cli.ts"]
tests_frozen: ["tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 350000, minutes: 90 }
---
## Passos
- [ ] commit RED: tests/examples.test.ts + overfit_holdout em tests/receipt.test.ts; PARE para revisão
- [ ] GREEN: src/examples.ts (parse, partição, render, holdout store, runHoldout); cli ganha `examples`
- [ ] GREEN: verify.ts roda o holdout depois de um done_when pass; receipt.ts ganha o reason_code
- [ ] commit GREEN com caminhos explícitos; mise run stable
- [ ] fechar: pinga-stable verify, pinga-stable judge e eval de tasks/T10/PLAN.md

## Dívidas conscientes
- holdout oculto por convenção (D12): um operário com shell pode ler PINGA_HOLDOUT_DIR
- só alvo TS/JS chamado como função (input = args, output via toEqual); sem Java/Python
- arquivos gerados que diferem são recusados; regenerar exige apagar à mão

## Fora
- teste de propriedade, caracterização, mutação; holdout obrigatório em completo (D12)
