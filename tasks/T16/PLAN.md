---
mode: padrao
goal: "Ingestão multi-harness em learn.db: suporta sessões do pi JSONL, opencode.db, hermes state.db e arquivos de fricção Markdown, com blocklist estrita de credenciais (auth.json, .env), redação 3 camadas e canário."
done_when: "bun test tests/multi-ingest.test.ts tests/examples/T16.test.ts"
touch: ["src/transcript.ts", "src/learn.ts", "src/cli.ts"]
tests_frozen: ["tests/multi-ingest.test.ts", "tests/examples/T16.test.ts", "tests/lessons.test.ts", "tests/learn.test.ts", "tests/redact.test.ts"]
budget: { tokens: 400000, minutes: 120 }
id: T16
title: "Ingestão multi-harness (pi, opencode, hermes, fricção)"
spec: specs/0004-p-inga-v0.2-metodos.md
phase: 5
verify: "bun test tests/multi-ingest.test.ts tests/examples/T16.test.ts"
max_attempts: 3
risk_flags: []
holdout_rule: "sha256 partition >= 4 visible + 2 holdout"
examples_cmd: "pinga examples tasks/T16/PLAN.md --from /tmp/pinga-examples/T16.yaml"
---
## Passos
- [ ] RED: tests/multi-ingest.test.ts; prove-red exit 0; GREEN: transcript/learn/cli; eval
## Exemplos (gerados antes do código)
1. in: pi-tool -> out: ok; 2. in: pi-stop -> out: ok; 3. in: opencode -> out: ok
4. in: hermes -> out: ok; 5. in: friction -> out: ok; 6. in: auth.json -> out: error
## Dívidas conscientes / Fora
- blocklist estrita de arquivos de credenciais; redação 3 camadas; v0.3
