---
mode: padrao
goal: "Fechar a brecha de recibo sem trabalho: guarda `delta_no_touch` (pass exige alteração real em arquivo do touch) e estado `superseded` (task cujo contrato já está verde no HEAD sai da fila sem recibo de pass falso)."
done_when: "bun test tests/queue.test.ts && bun run src/cli.ts queue --json > /dev/null && bun build src/cli.ts --target=bun --outdir /tmp/pinga-q-build"
touch: ["src/receipt.ts", "src/guards.ts", "src/verify.ts", "src/queue.ts", "src/cli.ts", "src/supersede.ts", "tests/queue.test.ts", "tasks/T37/PLAN.md"]
---
## Passos
- [x] Diagnóstico: executor selou `pass` em T02 sem alterar um único arquivo — `done_when` já passava no HEAD, então exit 0 chegou a recibo sem prova de trabalho
- [x] RED: `tests/queue.test.ts` — com `requireDelta`, `evaluateGuards` devolve `delta_no_touch` (exit 7) quando nenhum arquivo do `touch` mudou; `allowNoDelta` desarma; recibo `blocked`/`superseded` vira estado `superseded` e `nextTask` não o escolhe
- [x] GREEN: `src/guards.ts` — `DELTA_NO_TOUCH_EXIT = 7` (fora de `GUARD_EXIT`, que é shape congelado por `tests/guards.test.ts`), `delta` = `changed ∩ (touch ∪ EXEC/EVAL da task)` sem provisórios, armado só com `requireDelta`
- [x] GREEN: `src/receipt.ts` — `superseded` em `REASON_CODES`; `src/verify.ts` — terceiro caso de guarda no recibo
- [x] GREEN: `src/queue.ts` — estado `superseded` (receipt `blocked` + reason `superseded`), contagem e `nextTask`
- [x] GREEN: `src/cli.ts` — `pinga verify --require-delta` / `--allow-no-delta` e `pinga supersede <TASK> --reason TEXTO` (roda o `done_when`, exige exit 0, sela recibo `blocked`/`superseded` com evidência)
- [x] Evidência: `bun test tests/queue.test.ts` + `tests/guards.test.ts` verdes; T03–T15 superseded pelo CLI real (13 recibos `blocked`/`superseded` com artefato `runs/<T>/supersede/out.txt`); fila: `open 4 · blocked 3 · done 15 · superseded 13`
- [ ] Selar recibo no ledger (`pinga verify tasks/T37/PLAN.md`)
## Regra dura
- `pass` autônomo exige evidência de trabalho: `done_when` exit 0 **e** pelo menos um arquivo do `touch` alterado desde o claim (`--require-delta`). Sem isso, `blocked`/`delta_no_touch`. `verify` manual sem a flag mantém o contrato congelado de `tests/guards.test.ts` (no-op aceito).
- Pendência declarada: `tests/receipt.test.ts` fixa `REASON_CODES` na lista exata; os dois códigos novos quebram essa asserção → decisão do operador em T01 (teste congelado, não edito por conta própria).
- `supersede` não é atalho para `pass`: o recibo é `blocked` com reason `superseded`. Nunca inventa atestação.
## Não-objetivos
- Sem commit/merge; trabalho na worktree `p-inga-queue` (branch `task/task-queue`).
- Sem afrouxar `scope_drift`: baseline do claim continua valendo.
