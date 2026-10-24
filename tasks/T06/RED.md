# RED T06 — tests/tokens.test.ts

Só `bun:test` e built-ins do Bun 1.4.4 (`Bun.spawnSync`, `node:crypto`, `node:fs`, `node:path`, `node:os`). Zero dependências npm (D4). As fixtures JSONL são escritas pelo próprio teste em `mkdtemp`, sem arquivos novos fora de `tests/`.

## API esperada

```ts
// src/tokens.ts
import type { Receipt } from "./receipt";

export type UsageTotals = {
  in: number;               // inteiro ≥ 0
  out: number;              // inteiro ≥ 0
  cache: number | null;     // null se nenhuma linha trouxe campo de cache
  cost_usd: number | null;  // null se nenhuma linha trouxe custo
  lines: number;            // linhas de uso contadas (após dedup)
};
export type TokenFields = Pick<Receipt, "tokens" | "cost_usd" | "cost_evidence">;

export const NOT_RUN_TOKENS: TokenFields;
//   { tokens: { in: null, out: null, cache: null, source: null }, cost_usd: null, cost_evidence: "not run" }
export function parseUsageJsonl(text: string):
  | { ok: true; totals: UsageTotals }
  | { ok: false; error: string };
export function resolveUsageFile(flag: string | undefined, env?: Record<string, string | undefined>): string | null;
//   flag não vazia ?? env.PINGA_USAGE_FILE não vazia ?? null   (env padrão = process.env)
export function tokenFieldsFor(path: string | null): TokenFields;

// src/verify.ts
export type VerifyOptions = { base?: string; usageFile?: string };
```

## Comportamento esperado

1. **Linhas:**
   - cada linha não vazia do arquivo é um JSON; linhas em branco e a quebra final são ignoradas;
   - JSON inválido → `{ ok: false, error }`, com `error` contendo `linha <n>` (contada a partir de 1);
   - linhas que não casam com nenhum formato (mensagem de usuário, system, summary) são ignoradas.
2. **Formatos reconhecidos.** As chaves decidem o formato, não o nome do host:

   | Host | Onde está o uso | in / out | cache | custo |
   |---|---|---|---|---|
   | Claude Code | `message.usage` com `input_tokens` e `output_tokens` | `input_tokens` / `output_tokens` | `cache_read_input_tokens` + `cache_creation_input_tokens` | `costUSD` na raiz, se número |
   | pi | `usage` na raiz **ou** `message.usage`, com `input` e `output` | `input` / `output` | `cacheRead` + `cacheWrite` | `usage.cost.total`, se número |
   | opencode/agy | `tokens` na raiz, com `input` e `output` | `input` / `output` | `tokens.cache` (número, ou `{ read, write }` somados) | `cost_usd` ou `cost` na raiz, se número |

   No Claude Code, linhas com o mesmo `message.id` contam **uma vez** (a primeira); o Claude Code repete o `usage` por bloco de conteúdo.
3. **Valores:**
   - todo valor de token presente precisa ser inteiro ≥ 0, senão `{ ok: false }`;
   - custo presente precisa ser número finito ≥ 0;
   - campo de cache ausente na linha não soma nada;
   - `cache` total é `null` se **nenhuma** linha de uso trouxe campo de cache. O mesmo vale para `cost_usd`;
   - `cost_usd` é arredondado com `Number(sum.toFixed(6))`.
4. **Zero linhas de uso** (inclusive arquivo vazio) → `{ ok: false, error }` com `error` contendo `nenhuma linha de uso`.
5. **`tokenFieldsFor(path)`:**
   - `null` → `NOT_RUN_TOKENS`;
   - arquivo legível e válido →
     ```ts
     {
       tokens: { in, out, cache, source: "host-structured" },
       cost_usd,
       cost_evidence: `host-structured:${resolve(path)}#${sha256hex(bytes do arquivo)}`,
     }
     ```
   - inexistente, ilegível ou inválido →
     ```ts
     {
       tokens: { in: null, out: null, cache: null, source: null },
       cost_usd: null,
       cost_evidence: `invalid:${resolve(path)}: ${motivo}`, // cortado em 280
     }
     ```
   - **nunca** inventa `0`.
6. **Integração no `verify`:**
   - o arquivo é lido **depois** do `done_when`, ou no momento do bloqueio;
   - os campos vão em **todo** recibo do verify: pass, fail, timeout, disjuntor, guardas e `plan_invalid`;
   - os tokens não mudam status nem exit;
   - arquivo inválido → aviso no stderr contendo `usage` e o motivo.
7. **CLI:**
   - `pinga verify <PLAN.md> [--ledger PATH] [--attempt N] [--base SHA] [--usage-file PATH]`;
   - `--usage-file` vence `PINGA_USAGE_FILE`;
   - `--usage-file` sem valor → exit 2.

## Casos

1. Claude Code, com 2 linhas `assistant` de ids `m1` e `m2`, mais uma linha repetida de `m1`, uma linha `user` e uma `summary`:
   - `m1`: `input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20`;
   - `m2`: `input_tokens: 3, output_tokens: 2` (sem cache);
   - resultado: `{ in: 13, out: 7, cache: 120, cost_usd: null, lines: 2 }`.
2. Claude Code com `costUSD: 0.01` e `0.02` em duas mensagens distintas → `cost_usd` `toBeCloseTo(0.03)`.
3. pi:
   - `{"type":"message","message":{"role":"assistant","usage":{"input":10,"output":5,"cacheRead":3,"cacheWrite":2,"cost":{"total":0.001}}}}`;
   - `{"usage":{"input":1,"output":1}}`;
   - resultado: `{ in: 11, out: 6, cache: 5, cost_usd: 0.001, lines: 2 }`.
4. opencode/agy:
   - `{"tokens":{"input":100,"output":20,"cache":{"read":7,"write":1}},"cost_usd":0.02}`;
   - `{"tokens":{"input":1,"output":1,"cache":4},"cost":0.5}`;
   - resultado: `{ in: 101, out: 21, cache: 12 }`, `cost_usd` ≈ 0.52.
5. Os três formatos no mesmo arquivo → soma de tudo.
6. Sem nenhum campo de cache nem de custo → `cache: null` e `cost_usd: null`, mas `in` e `out` numéricos.
7. Inválidos:
   - 2ª linha `{oops` → `ok: false`, `error` contém `linha 2`;
   - arquivo vazio → `ok: false`, `nenhuma linha de uso`;
   - só linhas `user` → `nenhuma linha de uso`;
   - `input_tokens: -1` → `ok: false`;
   - `input: 1.5` → `ok: false`.
8. Linhas em branco no meio e `\n` final não mudam o resultado.
9. `resolveUsageFile`:
   - `("a", { PINGA_USAGE_FILE: "b" })` → `"a"`;
   - `(undefined, { PINGA_USAGE_FILE: "b" })` → `"b"`;
   - `(undefined, {})` → `null`;
   - `("", { PINGA_USAGE_FILE: "" })` → `null`.
10. `tokenFieldsFor(null)` é igual (`toEqual`) a `NOT_RUN_TOKENS`, com `tokens.in === null` e **não** `0`.
11. `tokenFieldsFor(<fixture válida>)`:
    - `source: "host-structured"`;
    - `cost_evidence === "host-structured:" + resolve(p) + "#" + sha256hex(readFileSync(p))`;
    - o objeto, encaixado num recibo mínimo, passa no `validateReceipt`.
12. `tokenFieldsFor("/nao/existe.jsonl")` e `tokenFieldsFor(<arquivo com {oops>)` → tokens `null`, `source: null`, `cost_usd: null`, `cost_evidence` começa com `invalid:` e tem ≤ 280 caracteres.

Casos de CLI: repo temporário sem commit RED, ledger fora do repo, `bun <ROOT>/bin/pinga.ts verify ...`.

13. `done_when: "true"` + `--usage-file <fixture do caso 1>` → exit 0, recibo com `tokens: { in: 13, out: 7, cache: 120, source: "host-structured" }`, `validateReceipt` ok.
14. `PINGA_USAGE_FILE=<fixture 1>` sem flag → mesmos tokens. Com `PINGA_USAGE_FILE=<fixture 1>` e `--usage-file <fixture 3>` → tokens da fixture 3.
15. Sem flag e sem env (o teste remove `PINGA_USAGE_FILE` do env filho) → `tokens` todos `null`, `source: null`, `cost_usd: null`, `cost_evidence: "not run"`.
16. `--usage-file /nao/existe.jsonl` com `done_when: "true"` → exit 0 (não muda), `cost_evidence` começa com `invalid:`, stderr contém `usage`.
17. `done_when: "exit 7"` com `--usage-file` → exit 1 e tokens preenchidos. Plano de 26 linhas com `--usage-file` → exit 3 e tokens preenchidos.
18. `--usage-file` sem valor → exit 2.
19. Integração: `pinga ledger verify --ledger <tmp>` dá `ok <n>` depois dos casos 13–17.
