---
mode: padrao
goal: "pinga adopt: inspeciona HOME, gera backups com SHA-256 em .pinga/backups/<ts>/, remove symlinks quebrados ou legados sob --apply e registra posse no manifest.json (adopted: true) evitando conflitos no install."
done_when: "bun test tests/adopt.test.ts tests/examples/T18.test.ts"
touch: ["src/adopt.ts", "src/install.ts", "src/manifest.ts", "src/cli.ts"]
tests_frozen: ["tests/adopt.test.ts", "tests/examples/T18.test.ts", "tests/install.test.ts", "tests/doctor.test.ts"]
budget: { tokens: 350000, minutes: 90 }
id: T18
title: "Comando pinga adopt para absorver entradas locais"
spec: specs/0004-p-inga-v0.2-metodos.md
phase: 5
verify: "bun test tests/adopt.test.ts tests/examples/T18.test.ts"
max_attempts: 3
risk_flags: []
holdout_rule: "sha256 partition >= 4 visible + 2 holdout"
examples_cmd: "pinga examples tasks/T18/PLAN.md --from /tmp/pinga-examples/T18.yaml"
---
## Passos
- [ ] RED: tests/adopt.test.ts; prove-red exit 0; GREEN: adopt/install/manifest/cli; eval
## Exemplos (gerados antes do código)
1. in: claude-local -> adopted; 2. in: broken-sym -> cleaned; 3. in: missing -> skipped
4. in: owned -> already_owned; 5. in: opencode -> adopted; 6. in: invalid -> error
## Dívidas conscientes / Fora
- backup atômico antes de qualquer mutação; v0.3
