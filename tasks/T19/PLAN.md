---
mode: padrao
goal: "pinga learn audit: audita incidência de --no-verify nos tool calls contra commits reais do git, e avalia precisão de amostra de até 30 lições (sampleSize, usefulCount, precisionRatio, passesGate >= 0.70)."
done_when: "bun test tests/audit.test.ts tests/examples/T19.test.ts"
touch: ["src/audit.ts", "src/lessons.ts", "src/cli.ts"]
tests_frozen: ["tests/audit.test.ts", "tests/examples/T19.test.ts", "tests/lessons.test.ts", "tests/learn.test.ts"]
budget: { tokens: 350000, minutes: 90 }
id: T19
title: "Auditoria empírica de --no-verify e precisão de lições"
spec: specs/0004-p-inga-v0.2-metodos.md
phase: 5
verify: "bun test tests/audit.test.ts tests/examples/T19.test.ts"
max_attempts: 3
risk_flags: []
holdout_rule: "sha256 partition >= 4 visible + 2 holdout"
examples_cmd: "pinga examples tasks/T19/PLAN.md --from /tmp/pinga-examples/T19.yaml"
---
## Passos
- [x] RED: tests/audit.test.ts; prove-red exit 0; GREEN: audit/lessons/cli; eval
## Exemplos (gerados antes do código)
1. in: calls=2, git=1 -> 0.5; 2. in: calls=0 -> 1.0; 3. in: 23/30 -> pass
4. in: 15/30 -> fail; 5. in: 8/10 -> pass; 6. in: 0/0 -> fail
## Dívidas conscientes / Fora
- amostragem determinística por sha256; v0.3
