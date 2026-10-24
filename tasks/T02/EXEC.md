Você é o EXECUTOR da T02 (opencode opencode/deepseek-v4.1-flash-free) no repo /home/shibuka/Projetos/duh-homelab/p-inga.

== 1. REGRAS DO EXECUTOR ==
- O commit RED já existe no commit `3c3b9d3` (`test(T02): RED canonicalJson, ledger append-only e CLI ledger verify`). Você faz **só o GREEN**.
- No GREEN, só crie ou edite arquivos listados em `touch`:
  `touch`: `["src/canonical.ts", "src/ledger.ts", "src/cli.ts", "bin/pinga.ts", "package.json"]`
- Nunca edite arquivos de `tests_frozen`:
  `tests_frozen`: `["tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
  E também não mexa em `src/receipt.ts`.
- Nunca `git add .`/`-A`: sempre caminhos explícitos. Nunca `--no-verify`. Nunca push.
- Nenhuma dependência npm. Só built-ins do Bun 1.4.4 (`bun:sqlite`, `node:crypto`, `node:fs`, `node:path`).
- Disjuntor manual: se o `done_when` falhar duas vezes seguidas com a mesma saída e você não tiver informação nova, PARE e reporte as duas saídas. Não tente uma terceira vez.
- Não declare "passou" sem colar a saída real do `done_when`. Status só em `pass`, `fail`, `blocked` ou `not run`.
- Não toque em nada fora de `/home/shibuka/Projetos/duh-homelab/p-inga`. Não adicione `tasks/T02/EXEC.md` no commit.

== 2. CONTRATO DA T02 ==
Leia `tasks/T02/PLAN.md`, `tasks/T02/RED.md`, `src/receipt.ts` e `tests/ledger.test.ts` inteiros.

### APIs do Bun 1.4.4 usadas nesta task:
```ts
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const db = new Database(path);
db.run("CREATE TABLE IF NOT EXISTS ...");
const rows = db.query("SELECT ...").all();
db.close();
```

### 1. `src/canonical.ts`
```ts
export function canonicalJson(x: unknown): string;
```
- Serializa `x` para JSON compacto (sem espaços extras), com chaves de objetos ordenadas lexicograficamente (`Object.keys(x).sort()`), arrays mantendo a ordem original, e chaves cujo valor seja `undefined` omitidas (como `JSON.stringify`). Primitivos (`null`, `boolean`, `number`, `string`) usam `JSON.stringify(x)`.

### 2. `src/ledger.ts`
```ts
export const GENESIS = "0".repeat(64);
export function defaultLedgerPath(env?: Record<string, string | undefined>): string;
// env.PINGA_LEDGER ?? `${env.XDG_STATE_HOME ?? `${env.HOME}/.local/state`}/pinga/ledger.db`

export type LedgerRow = {
  seq: number;
  task: string;
  status: string;
  body: string;
  prev_hash: string;
  hash: string;
  created_at?: string;
};

export function openLedger(path: string): {
  append(r: unknown): { seq: number; hash: string };
  all(): Array<{ seq: number; task: string; status: string; body: string; prev_hash: string; hash: string }>;
  verify(): { ok: true; count: number } | { ok: false; brokenAt: number };
  close(): void;
};
```
- Cria o diretório pai (`mkdirSync(dirname(path), { recursive: true })`).
- Tabela:
  `CREATE TABLE IF NOT EXISTS receipts(seq INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT, status TEXT, body TEXT, prev_hash TEXT, hash TEXT, created_at TEXT)`
- Triggers append-only:
  ```sql
  CREATE TRIGGER IF NOT EXISTS receipts_no_update BEFORE UPDATE ON receipts
  BEGIN SELECT RAISE(ABORT, 'append-only'); END;
  CREATE TRIGGER IF NOT EXISTS receipts_no_delete BEFORE DELETE ON receipts
  BEGIN SELECT RAISE(ABORT, 'append-only'); END;
  ```
- `append(r: unknown)`:
  1. Valida `r` com `validateReceipt(r)` de `./receipt`. Se `!res.ok`, lança `new Error(res.errors.join("; "))` sem gravar nada.
  2. Obtém o último `hash` da tabela (`SELECT hash FROM receipts ORDER BY seq DESC LIMIT 1`), ou `GENESIS` se vazia.
  3. `const body = canonicalJson(res.receipt);`
  4. `const hash = sha256hex(prev_hash + "\n" + body);`
  5. Insere na tabela `(task, status, body, prev_hash, hash, created_at)` e retorna `{ seq: Number(info.lastInsertRowid), hash }`.
- `all()`: retorna todas as linhas ordenadas por `seq ASC`.
- `verify()`:
  Percorre todas as linhas em `seq ASC`:
  - Verifica se `row.prev_hash === expectedPrevHash` (começando em `GENESIS`).
  - Faz `JSON.parse(row.body)`, valida com `validateReceipt`, recalcula `sha256hex(row.prev_hash + "\n" + canonicalJson(parsed))` e verifica se bate com `row.hash` e `row.body === canonicalJson(parsed)`.
  - Se qualquer checagem falhar na linha `row`, retorna `{ ok: false, brokenAt: row.seq }`.
  - Se todas passarem, retorna `{ ok: true, count: rows.length }`.

### 3. `src/cli.ts` e `bin/pinga.ts`
- `bin/pinga.ts`: entrypoint (`#!/usr/bin/env bun`) que chama `runCli(process.argv.slice(2))` de `../src/cli`.
- Suporta `bun bin/pinga.ts ledger verify [--ledger PATH]`:
  - Abre o ledger em `PATH` (ou `defaultLedgerPath()`), roda `verify()` e fecha.
  - Se `ok`: imprime `ok <count>` no stdout e sai com `0`.
  - Se `!ok`: imprime `broken at <brokenAt>` e sai com `1`.

### 4. `package.json`
- Adicione `"bin": { "pinga": "bin/pinga.ts" }` mantendo os campos existentes da T00 (`type: "module"`, `private: true`, `scripts.test: "bun test"`, zero dependencies).

== 3. VERIFICAÇÃO E COMMIT ==
1. Rode o `done_when` exato:
   `bun test tests/ledger.test.ts`
2. Rode a suíte inteira:
   `bun test`
3. Confirme que os testes congelados não mudaram:
   `git diff 3c3b9d3..HEAD -- tests/ledger.test.ts tests/receipt.test.ts tests/repo.test.ts` (vazio)
4. Faça o commit GREEN:
   ```bash
   git add src/canonical.ts src/ledger.ts src/cli.ts bin/pinga.ts package.json
   mise exec pkl@0.32.1 -- git commit -m "feat(T02): ledger append-only encadeado por hash e pinga ledger verify" -m "Co-Authored-By: deepseek-v4.1-flash-free <noreply@deepseek.com>"
   ```

== 4. FIM OBRIGATÓRIO ==
Ao terminar, cole na sua resposta final:
1. A saída real de `bun test tests/ledger.test.ts` e `bun test`
2. O sha do commit GREEN (`git rev-parse --short HEAD`)
3. A saída de `git diff --stat 3c3b9d3..HEAD`
Depois PARE imediatamente.
