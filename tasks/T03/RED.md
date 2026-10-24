# RED T03 — `tests/verify.test.ts`

## API esperada

```ts
// src/plan.ts
export type Plan = {
  mode: "mvp" | "padrao" | "completo";
  goal: string;
  done_when: string;
  touch?: string[];
  tests_frozen?: string[];
  budget?: { tokens?: number; minutes?: number };
};
export function parsePlan(text: string):
  | { ok: true; plan: Plan }
  | { ok: false; errors: string[] };
```

## Comportamento esperado

`bun bin/pinga.ts verify <PLAN.md> [--ledger PATH] [--attempt N]`

1. **Lint do plano** (`src/plan.ts`, `parsePlan(text) → { ok: true, plan } | { ok: false, errors }`):
   - no máximo 25 linhas (ignorando uma única quebra de linha `\r?\n` final: `text.replace(/\r?\n$/, "").split(/\r?\n/).length <= 25`);
   - frontmatter entre linhas `---`, lido com `Bun.YAML.parse`;
   - `mode ∈ {mvp, padrao, completo}`;
   - `goal`: string de até 280 caracteres;
   - `done_when`: string não vazia;
   - `touch`: `string[]`, obrigatório em `padrao` e `completo`;
   - `tests_frozen?`: `string[]`;
   - `budget?`: `{ tokens?: inteiro, minutes?: number }`.
2. **Id da task:** nome da pasta do plano (ex.: `tasks/T01/PLAN.md` → `T01`).
3. **Execução do `done_when`:**
   - roda `sh -c <done_when>` com `cwd` = `git rev-parse --show-toplevel` do plano;
   - timeout = `PINGA_TIMEOUT_MS` ?? `budget.minutes × 60000` ?? 30 min;
   - stdout + stderr vão para `runs/<task>/<attempt>/out.txt` na raiz do repo.
4. **Tentativa:** padrão = 1 + número de recibos dessa task no ledger.
5. **Recibo** (valida com `validateReceipt` da T01):
   - status e exit do processo:

     | Situação | status | `reason_code` | exit do `pinga` |
     |---|---|---|---|
     | `done_when` sai com 0 | `pass` | `null` | 0 |
     | `done_when` sai com ≠ 0 | `fail` | `command_failed` | 1 |
     | timeout | `blocked` | `budget` | 2 |
     | lint falhou | `blocked` | `plan_invalid` (com `evidence: []`) | 3 |

   - `evidence[0]`:
     - `cmd_sha256` = sha256 do `done_when`;
     - `exit` (inteiro quando o comando terminou normalmente; `null` em caso de timeout);
     - `duration_ms`;
     - `artifact_ref` = `{ path: "runs/<task>/<attempt>/out.txt", sha256 do arquivo }`;
   - tokens todos `null` com `source: null`; `cost_usd: null`; `cost_evidence: "not run"`;
   - `author.model` = `PINGA_AUTHOR_MODEL` ?? `null`; `author.family` = `PINGA_AUTHOR_FAMILY` ?? `null`; `verified_by: null`;
   - `summary` = `` `${task} ${status}: done_when exit ${exit} em ${segundos}s` ``, até 280 caracteres (em timeout, `exit` é `null`, gerando `exit null`). Se o lint falhar: `` `${task} blocked: plano inválido (${errors[0]})` ``, cortado em 280.
6. **Gravação:** o recibo vai para o ledger (`--ledger` ou `defaultLedgerPath()`) e o JSON é impresso no stdout.
7. **`scripts/stable.ts`** (task do mise: `stable`):
   - se `git status --porcelain` não estiver vazio → exit 1 com a mensagem `árvore suja`;
   - senão → `bun build --compile bin/pinga.ts --outfile .pinga/pinga-stable` e grava `.pinga/stable.json` com `{ commit, builtAt }`.

## Casos

Cada caso cria um repo git temporário (`mkdtemp` + `git init`) com `tasks/TX/PLAN.md` e um ledger temporário.

1. Plano com 26 linhas → exit 3; o recibo tem `blocked` / `plan_invalid`; o ledger tem 1 linha.
2. Plano sem `done_when` → exit 3. Com `mode: rapido` → exit 3.
3. `done_when: "true"` → exit 0; o recibo tem `pass`, `reason_code: null` e `evidence[0].exit` 0.
4. `done_when: "exit 7"` → exit 1; o recibo tem `fail`, `command_failed` e `exit` 7.
5. `done_when: "sleep 5"` com `PINGA_TIMEOUT_MS=200` → exit 2; o recibo tem `blocked`, `budget` e `evidence[0].exit === null`.
6. `done_when: "yes | head -c 1000000"` → o recibo serializado tem ≤ 4096 bytes, e o sha256 de `out.txt` é igual a `artifact_ref.sha256`.
7. Rodar duas vezes o mesmo plano → `attempts` 1 e depois 2, e `out.txt` em `runs/TX/1/` e `runs/TX/2/`.
8. Todo recibo impresso passa no `validateReceipt`, e `pinga ledger verify` continua `ok`.
9. `bun <caminho absoluto>/scripts/stable.ts` com `cwd` = repo temporário com um arquivo modificado → exit 1 e `árvore suja` no stderr.
