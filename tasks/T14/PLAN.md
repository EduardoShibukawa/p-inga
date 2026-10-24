---
mode: padrao
goal: "learn.db (I19): bun:sqlite fora do repo e do ledger, uma linha por recibo, EVAL ou transcript Claude; redação regex + denylist + entropia ≥ 4,0 antes de gravar, canário que aborta (exit 15); tokens NULL nunca 0; model_family por modelFamily; reingestão idempotente."
done_when: "bun test tests/redact.test.ts tests/learn.test.ts"
touch: ["src/redact.ts", "src/learn.ts", "src/transcript.ts", "src/cli.ts"]
tests_frozen: ["tests/learn.test.ts", "tests/redact.test.ts", "testdata/secrets/fake-token.txt", "tests/adapters.test.ts", "tests/doctor.test.ts", "tests/helpers/stubs.ts", "tests/install.test.ts", "tests/helpers/home.ts", "tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 400000, minutes: 120 }
---
## Passos
- [ ] commit `test(T14): fixture fake-token` só com testdata/secrets/fake-token.txt (suíte ainda verde)
- [ ] commit RED: tests/redact.test.ts + tests/learn.test.ts; prove-red exit 0; PARE para revisão
- [ ] GREEN: redact.ts (regex, denylist, entropia, canário, clip); cli ganha `learn scan`
- [ ] GREEN: transcript.ts (Claude JSONL); learn.ts (schema, ingest recibo/EVAL/transcript); `learn ingest`
- [ ] commit GREEN com caminhos explícitos; mise run stable; verify, judge e eval de tasks/T14/PLAN.md

## Dívidas conscientes
- só transcripts do Claude Code; pi JSONL, opencode.db e Hermes state.db ficam para a v0.2
- entropia erra nos dois sentidos; segredo de baixa entropia só cai pela denylist que o dono gera
- verificação do transcript = is_error do tool_result do comando de teste, não exit code literal

## Fora
- detectores e propostas (T15); hook de pre-commit com o scanner; ler arquivos de credenciais reais
