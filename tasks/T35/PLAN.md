---
mode: padrao
goal: "Fila determinística de tasks (pinga queue): scan de estados, lease com TTL, claim/release, snapshot de transições e notificação Discord — para que a janela principal só planeje e um executor assíncrono (Hermes/cron) rode as tasks abertas."
done_when: "bun test tests/queue.test.ts && bun run src/cli.ts queue --json > /dev/null && bun build src/cli.ts --target=bun --outdir /tmp/pinga-q-build"
touch: ["src/queue.ts", "src/cli.ts", "tests/queue.test.ts", "tasks/T35/PLAN.md"]
---
## Passos
- [x] RED: `tests/queue.test.ts` — 13 testes (scan, claim concorrente, TTL, release, probe escopado, probe com timeout, snapshot+transitions+digest)
- [x] GREEN: `src/queue.ts` — `QUEUE_VERSION=1`, `DEFAULT_LEASE_TTL_S=1800`, estados `done|awaiting_receipt|blocked|leased|open|invalid_plan`, `scanQueue/claim/nextTask/release/transitions/formatQueueDigest/readSnapshot/writeSnapshot`
- [x] GREEN: `src/cli.ts` — subcomando `queue` com `--json`, `--notify`, `--root`, `--ledger`, `--claim [--ttl S]`, `--release TASK`, `--probe TASK | --probe-all`, `--probe-timeout S`
- [x] Evidência: `bun test` 238 pass / 0 fail; `queue --notify` → digest entregue no Discord (#hermes)
- [ ] Selar recibo no ledger (`pinga verify tasks/T35/PLAN.md`)
## Regra dura
- `done_when` exit 0 SEM receipt `pass` no ledger ⇒ estado `awaiting_receipt`, nunca `done`. Zero auto-atestação.
- Probe é opt-in (`--probe TASK` / `--probe-all`) com timeout default 10s: um scan nunca pendura o executor.
## Não-objetivos
- Sem commit/merge nesta fatia; trabalho isolado na worktree `p-inga-queue` (branch `task/task-queue`).
- Sem daemon próprio: o executor é cron do Hermes; `pinga queue` só responde perguntas determinísticas.
