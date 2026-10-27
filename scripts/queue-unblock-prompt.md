# Janela de iteração em task bloqueada

Abra uma janela Hermes dedicada dentro da worktree:

```bash
cd /home/shibuka/Projetos/duh-homelab/p-inga-exec && hermes chat
```

Cole o prompt abaixo trocando `<T>` pela task (ex.: `T22`, `T01`, `T33`).

---

Você trabalha SÓ em `/home/shibuka/Projetos/duh-homelab/p-inga-exec` (worktree, branch `work/exec`).
Sincronize antes de começar: `git -C /home/shibuka/Projetos/duh-homelab/p-inga-exec reset --hard origin/main`
(só com a árvore limpa).
Nunca rode `git commit`, `git merge`, `git push` e nunca toque em
`/home/shibuka/Projetos/duh-homelab/p-inga` (raiz publicada, somente leitura).

Objetivo: desbloquear a task `<T>` corrigindo a causa — nunca afrouxando a régua.

1. `bun run src/cli.ts queue --json` e leia o estado/`reason_code` de `<T>`.
2. `bun run src/cli.ts queue --claim <T> --json` (claim forçado; o claim fotografa o
   baseline em `tasks/<T>/.baseline.json`).
3. Diagnostique pelo `reason_code`:
   - `scope_drift` → o arquivo alterado está fora do `touch` do PLAN. Ou a mudança é legítima
     (então o PLAN precisa cobri-la) ou é lixo (então reverta). Baseline só desconta o que
     está idêntico ao claim.
   - `tests_frozen_changed` → teste congelado foi alterado; restaurar o teste e mover a
     asserção para o teste da fatia.
   - `model_unattested` → falta atestação de modelo; decisão do operador, pare e relate.
   - `delta_no_touch` → recibo sem trabalho. Se a task é autônoma, implemente o contrato;
     se o contrato já está satisfeito no base, sele com
     `bun run src/cli.ts supersede <T> --reason "<motivo factual>"` (roda o `done_when`
     real e grava `runs/<T>/supersede/out.txt`; nunca forja `pass`).
   - `not_executed` / `awaiting_receipt` → rode o `done_when` e sele o recibo.
4. `bun run src/cli.ts verify tasks/<T>/PLAN.md --attempt <N+1> [--require-delta]`
   (N = attempts do último recibo; use `--base $(git rev-parse HEAD)` se pedir).
   `--require-delta` é obrigatório quando o selo é autônomo e o claim veio **antes** do
   trabalho. Claim depois da implementação desconta tudo como idêntico ao baseline e o
   `verify` devolve `delta_no_touch` mesmo com trabalho real.
5. Sempre `bun run src/cli.ts queue --release <T>` ao terminar, com ou sem sucesso.
6. Reporte em até 6 linhas: task, status do recibo + reason_code, arquivos alterados,
   próximo passo.

Regra dura: `done_when` exit 0 sem recibo `pass` NUNCA é sucesso. Mudar `REASON_CODES`/
`STATUSES` (schema) quebra teste congelado: peça decisão do operador em vez de editar o
teste. O vigia
(`pinga-queue-watch.timer`, 5 min) detecta a transição e avisa no Discord `#hermes`.
