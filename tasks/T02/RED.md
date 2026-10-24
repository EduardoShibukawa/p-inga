# RED T02 — `tests/ledger.test.ts`

## API esperada

```ts
// src/canonical.ts
export function canonicalJson(x: unknown): string;   // chaves ordenadas, arrays na ordem original, sem espaços, chaves com valor undefined omitidas (como JSON.stringify)

// src/ledger.ts
export const GENESIS = "0".repeat(64);
export function defaultLedgerPath(env = process.env): string;
//   env.PINGA_LEDGER ?? `${env.XDG_STATE_HOME ?? `${HOME}/.local/state`}/pinga/ledger.db`
export function openLedger(path: string): {
  append(r: unknown): { seq: number; hash: string };   // valida com validateReceipt; inválido lança, sem gravar
  all(): Array<{ seq: number; task: string; status: string; body: string; prev_hash: string; hash: string }>;
  verify(): { ok: true; count: number } | { ok: false; brokenAt: number };
  close(): void;
};
```

## Schema e regras

- **Tabela:** `receipts(seq INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT, status TEXT, body TEXT, prev_hash TEXT, hash TEXT, created_at TEXT)`.
- **Hash:** `hash = sha256hex(prev_hash + "\n" + canonicalJson(recibo))`. O primeiro `prev_hash` é `GENESIS`.
- **Append-only:** triggers `BEFORE UPDATE` e `BEFORE DELETE` com `RAISE(ABORT, 'append-only')`.
- **Pastas:** criadas se não existirem.
- **CLI** (`bun bin/pinga.ts ledger verify [--ledger PATH]`):
  - ok → exit 0 e imprime `ok <count>`;
  - quebrado → exit 1 e imprime `broken at <seq>`.

## Casos

Todos usam um arquivo temporário (`mkdtemp`), nunca o ledger padrão.

1. `canonicalJson({b:1,a:{d:2,c:3}})` é igual a `canonicalJson({a:{c:3,d:2},b:1})`. Arrays mantêm a ordem: `[2,1]` ≠ `[1,2]`.
2. Três `append` de recibos válidos (reaproveite o recibo mínimo da T01) → `seq` 1, 2, 3; o `prev_hash` de cada um é o `hash` do anterior; `verify()` → `{ ok: true, count: 3 }`.
3. `append` de recibo inválido lança, e `all().length` não muda.
4. `UPDATE receipts SET status='fail'` via `bun:sqlite` direto → lança `append-only`. O mesmo vale para `DELETE`.
5. Adulteração: abrir o arquivo direto, `DROP TRIGGER` do update, mudar o `body` do seq 2, e então `verify()` → `{ ok: false, brokenAt: 2 }`.
6. `defaultLedgerPath({ PINGA_LEDGER: "/x/l.db" })` → `/x/l.db`. `defaultLedgerPath({ XDG_STATE_HOME: "/s", HOME: "/h" })` → `/s/pinga/ledger.db`. Só com `HOME: "/h"` → `/h/.local/state/pinga/ledger.db`.
7. CLI num ledger íntegro com 2 recibos → exit 0 e stdout `ok 2`. Depois da adulteração do caso 5 → exit 1 e `broken at 2`.
