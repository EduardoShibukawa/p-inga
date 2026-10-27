---
mode: padrao
goal: "Corrigir o scope_drift sistêmico que impedia qualquer task da fila de passar sem commit: baseline do claim (HEAD + sujeira fotograda com sha256) como fundamento do verify, flag --no-baseline como escape hatch e --claim TASK para reprocessar bloqueadas."
done_when: "bun test tests/queue.test.ts && bun run src/cli.ts queue --json > /dev/null && bun build src/cli.ts --target=bun --outdir /tmp/pinga-q-build"
touch: ["src/guards.ts", "src/verify.ts", "src/queue.ts", "src/cli.ts", "tests/queue.test.ts", ".gitignore", "tasks/T36/PLAN.md"]
---
## Passos
- [x] Diagnóstico: `verify` mede drift contra o commit RED da task; com a worktree suja e commits proibidos, toda task herdava `scope_drift` (T00 travou em `attempt` 2 e a fila parou na cabeça).
- [x] RED: teste 13 em `tests/queue.test.ts` — claim fotografa a sujeira, filtro remove o que está idêntico e volta a acusar após nova edição.
- [x] GREEN: `src/guards.ts` — `applyBaseline`, `fileDigest`, tipo `DriftBaseline`.
- [x] GREEN: `src/queue.ts` — `claimBaseline` `{v:1, head, dirty}` em `tasks/<T>/.baseline.json`, capturado no `claim`.
- [x] GREEN: `src/verify.ts` — base = `--base` > `head` do claim > RED; drift descontado pelo `dirty`; baseline ilegível não afrouxa; `--no-baseline` desliga.
- [x] GREEN: `src/cli.ts` — `--no-baseline` no verify e `queue --claim TASK` para task específica.
- [x] Evidência: `bun test tests/queue.test.ts` 14 pass / 0 fail; suíte completa 231 pass / 8 fail, e as **mesmas 8** falham no HEAD intocado (pré-existentes de ambiente: install/learn/redact) — zero regressão; `bun build` exit 0.
- [x] Evidência de campo: `queue --claim T00` → `verify --attempt 5` → `pass` 9513da6f (artefato `runs/T00/5/out.txt`); digest Discord `done 14`.
## Regra dura
- Baseline só desconta path cujo sha256 continua igual ao do claim. Arquivo tocado depois do claim continua sendo drift.
- `--base` explícito e `--no-baseline` vencem o baseline; falha ao ler o baseline cai no drift completo (nunca afrouxa).
## Não-objetivos
- Sem commit/merge; sem tocar no checkout principal.
- Não substitui `--prove-base`/`--override-mode`: é base de medição, não atalho de aprovação.
