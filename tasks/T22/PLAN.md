---
mode: padrao
goal: "Context Compactor & Protecao de Context Window: src/compact.ts (D35) e subcomando pinga compact (D36)."
done_when: "bun test tests/compact.test.ts"
touch: ["src/compact.ts", "src/cli.ts"]
tests_frozen: ["tests/compact.test.ts", "tests/maestro.test.ts"]
budget: { tokens: 300000, minutes: 60 }
id: T22
title: "Context Compactor para Modelos Locais"
spec: specs/0007-p-inga-v0.5-context-compactor.md
phase: 7
verify: "bun test tests/compact.test.ts"
max_attempts: 3
risk_flags: []
---
## Passos
- [x] RED: tests/compact.test.ts; prove-red exit 0; GREEN: src/compact.ts e cli; eval
## Exemplos (gerados antes do código)
1. in: total <= maxChars -> compacted: false; 2. in: tool observation > 300 -> trimmed
3. in: system & user msgs -> 100% preservadas; 4. in: ultimas 6 msgs -> 100% preservadas
## Dívidas conscientes / Fora
- integracao automatica em adapters hermes/opencode em v0.5.1