---
mode: padrao
goal: "Tokens medidos (I4/Lei 1): pinga verify lê o JSONL do host (--usage-file ou PINGA_USAGE_FILE; Claude Code, pi, opencode/agy) e soma in/out/cache/cost_usd com source host-structured e cost_evidence com sha256; sem arquivo, null e 'not run', nunca 0."
done_when: "bun test tests/tokens.test.ts"
touch: ["src/tokens.ts", "src/verify.ts", "src/cli.ts"]
tests_frozen: ["tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]
budget: { tokens: 300000, minutes: 75 }
---
## Passos
- [ ] commit RED: tests/tokens.test.ts com os casos de RED.md; PARE para revisão
- [ ] GREEN: src/tokens.ts (parser + agregação); verify.ts preenche tokens/cost em todo recibo; cli ganha `--usage-file`
- [ ] commit GREEN com caminhos explícitos; mise run stable
- [ ] fechar task: .pinga/pinga-stable verify tasks/T06/PLAN.md
- [ ] preencher EVAL.md

## Dívidas conscientes
- soma o arquivo inteiro: sem janela por tentativa
- out ignora tokens de reasoning do opencode
- arquivo inválido não muda o status; só cost_evidence "invalid:..."
- fechamento só mede tokens se o dono exportar PINGA_USAGE_FILE com o transcript

## Fora
- descoberta automática do transcript do host
- tabela de preços: cost_usd só quando o host informa
