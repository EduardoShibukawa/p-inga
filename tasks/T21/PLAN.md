---
mode: padrao
goal: "TDD Provisional & Integracao Gira-G: guards com isProvisionalTest (D33..D34 / I31..I32), subcomando pinga tdd e checagem de gira no doctor."
done_when: "bun test tests/provisional.test.ts"
touch: ["src/guards.ts", "src/cli.ts", "src/doctor.ts"]
tests_frozen: ["tests/provisional.test.ts", "tests/maestro.test.ts", "tests/guards.test.ts"]
budget: { tokens: 300000, minutes: 60 }
id: T21
title: "TDD Provisional & Integracao Gira-G"
spec: specs/0006-p-inga-v0.4-tdd-provisional.md
phase: 6
verify: "bun test tests/provisional.test.ts"
max_attempts: 3
risk_flags: []
---
## Passos
- [x] RED: tests/provisional.test.ts; prove-red exit 0; GREEN: guards/cli/doctor; eval
## Exemplos (gerados antes do código)
1. in: "tests/scratch_foo.py" -> isProvisional: true; 2. in: "tests/foo.test.ts" -> isProvisional: false
3. in: "tests/provisional/bar.py" -> isProvisional: true; 4. in: "src/app.ts" -> isProvisional: false
5. in: provisional file in changed -> guard ok: true (no tests_frozen_changed, no scope_drift)
## Dívidas conscientes / Fora
- auto-cleanup de provisional no verify final; runner multi-framework avançado v0.5