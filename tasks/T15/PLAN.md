---
mode: padrao
goal: "Lições propostas (I20): 5 detectores SQL determinísticos sobre o learn.db, LESSONS-PROPOSED.md com trecho redigido ≤ 300, métrica, ação e juiz; juiz de mesma família ou não atestado aborta tudo (exit 7/8) sem chamar o modelo nem escrever; promote humano auditável."
done_when: "bun test tests/lessons.test.ts"
touch: ["src/detect.ts", "src/lessons.ts", "src/cli.ts"]
tests_frozen: ["tests/lessons.test.ts", "tests/learn.test.ts", "tests/redact.test.ts", "testdata/secrets/fake-token.txt", "tests/adapters.test.ts", "tests/doctor.test.ts", "tests/helpers/stubs.ts", "tests/install.test.ts", "tests/helpers/home.ts", "tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 400000, minutes: 120 }
---
## Passos
- [x] commit RED: tests/lessons.test.ts com os casos de RED.md; prove-red exit 0; PARE para revisão
- [x] GREEN: detect.ts (DETECTORS, regras SQL, agrupamento por task, validateCandidate, descarte)
- [x] GREEN: lessons.ts (render/parse, juiz com pré-checagem I10, escrita atômica, promote + trilha)
- [x] GREEN: cli ganha `learn propose` e `learn promote`
- [x] commit GREEN com caminhos explícitos; mise run stable; verify, judge e eval de tasks/T15/PLAN.md; AC-G

## Dívidas conscientes
- só 5 detectores; custo fora da curva, fricção, correção do usuário e drift ficam para a v0.2
- precisão na amostra de 30 e replay no bench não medidos: EVAL da T15 diz not run
- juiz pequeno só anota aprovada/rejeitada; o humano decide no promote

## Fora
- classificação por LLM, detector sobre EVAL.md, escrever direto em LESSONS.md sem promote
