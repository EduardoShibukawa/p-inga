---
mode: padrao
goal: "Detector de correção do usuário de alta precisão: filtra turnos de subagente/sistema (is_sidechain=1, templates), captura correções humanas curtas (<=400 chars, marcadores PT/EN) pós-falha e registra 6º detector em detectAll."
done_when: "bun test tests/user-correction.test.ts tests/examples/T17.test.ts"
touch: ["src/detect.ts", "src/transcript.ts", "src/learn.ts"]
tests_frozen: ["tests/user-correction.test.ts", "tests/examples/T17.test.ts", "tests/lessons.test.ts", "tests/multi-ingest.test.ts"]
budget: { tokens: 350000, minutes: 90 }
id: T17
title: "Detector de correção do usuário de alta precisão"
spec: specs/0004-p-inga-v0.2-metodos.md
phase: 5
verify: "bun test tests/user-correction.test.ts tests/examples/T17.test.ts"
max_attempts: 3
risk_flags: []
holdout_rule: "sha256 partition >= 4 visible + 2 holdout"
examples_cmd: "pinga examples tasks/T17/PLAN.md --from /tmp/pinga-examples/T17.yaml"
---
## Passos
- [x] RED: tests/user-correction.test.ts; prove-red exit 0; GREEN: detect/transcript/learn; eval
## Exemplos (gerados antes do código)
1. in: "não, reverte isso" -> out: true; 2. in: "wrong file" -> out: true; 3. in: "stop" -> out: true
4. in: "ótimo, continue" -> out: false; 5. in: "<TASK>long prompt..." -> out: false; 6. in: "" -> out: false
## Dívidas conscientes / Fora
- heurística textual e temporal; sem LLM no loop do detector; v0.3
