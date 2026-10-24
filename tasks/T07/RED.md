# RED T07 — tests/eval.test.ts

Só `bun:test` e built-ins do Bun 1.4.4 (`bun:sqlite` via `openLedger`, `Bun.spawnSync`, `node:fs`, `node:path`, `node:os`, `node:crypto`). Zero dependências npm (D4).

## API esperada

```ts
// src/eval.ts
import type { Receipt, Status } from "./receipt";

export const PLANNER_DEFAULT = { model: "gemini-4-argon", family: "gemini" } as const;

export type Scope = {
  tests_frozen: "intacto" | "ALTERADO" | "sem base";
  out_of_touch: string[] | null;          // [] → "nenhum"; null → "sem base"
};
export type OwnerFields = { bom: string; ruim: string; mudar: string };
export type EvalDoc = {
  task: string;
  executor: string;                       // "<model> (<family>)"
  planner: string;                        // "<model> (<family>)"
  status: Status;
  attempts: number;                       // inteiro ≥ 1
  minutes: number;                        // inteiro ≥ 0
  tokens: string;                         // "not run" | "in=<n> out=<n> cache=<n|null> usd=<x|null>"
  scope: Scope;
  parecer: string;                        // não vazio
  dono: OwnerFields;                      // valores podem ser ""
};

export function renderEval(doc: EvalDoc): string;
export function parseEval(text: string):
  | { ok: true; doc: EvalDoc }
  | { ok: false; errors: string[] };
export function validateEval(text: string, task?: string):
  | { ok: true }
  | { ok: false; errors: string[] };
export function extractOwnerFields(text: string): OwnerFields & { parecer: string | null };
export function summarizeTokens(receipts: Receipt[]): string;
export function evalPlan(planPath: string, opts?: { ledgerPath?: string; check?: boolean }): number;
```

## Comportamento esperado

1. **Template.** `renderEval` produz exatamente 9 linhas mais um `\n` final:
   ```
   ## EVAL <task>
   executor: <executor> · planejador: <planner>
   auto:   status <status> · tentativas <attempts> · tempo <minutes> min · tokens <tokens>
   escopo: tests_frozen <intacto|ALTERADO|sem base> · fora do touch: <nenhum|sem base|a, b>
   parecer: <parecer>
   dono:
     bom:   <bom>
     ruim:  <ruim>
     mudar: <mudar>
   ```
   - `auto:` é seguido de 3 espaços;
   - com valor vazio, a linha do dono é só `  bom:`, `  ruim:` ou `  mudar:`, sem espaço final;
   - `fora do touch` é a lista ordenada, unida por `, `.
2. **`parseEval` / `validateEval`:**
   - o texto, sem uma única quebra final, tem exatamente as 9 linhas na ordem acima;
   - padrões de cada linha:

     | Linha | Regex |
     |---|---|
     | cabeçalho | `^## EVAL (\S+)$` |
     | executor | `^executor: (.+ \(.+\)) · planejador: (.+ \(.+\))$` |
     | auto | `^auto:\s+status (pass\|fail\|blocked\|not run) · tentativas (\d+) · tempo (\d+) min · tokens (.+)$` |
     | escopo | `^escopo: tests_frozen (intacto\|ALTERADO\|sem base) · fora do touch: (.+)$` |
     | parecer | `^parecer: (.+)$` |
     | dono | `^dono:$` |
     | bom / ruim / mudar | `^  bom:\s*(.*)$`, `^  ruim:\s*(.*)$`, `^  mudar:\s*(.*)$` (valor com trim) |

   - `tentativas ≥ 1`;
   - `tokens` casa `^not run$` ou `^in=\d+ out=\d+ cache=(\d+|null) usd=(\d+(\.\d+)?|null)$`;
   - os erros são acumulados;
   - `validateEval(text, task)` também exige que o cabeçalho seja `## EVAL ${task}`;
   - `parseEval(renderEval(doc))` devolve `doc` igual (round-trip).
3. **`extractOwnerFields`** é tolerante. Varre linha a linha com `^\s*(bom|ruim|mudar):\s*(.*)$` e `^parecer:\s*(.*)$`, mesmo que o resto do arquivo seja inválido. O que faltar vira `""`; o parecer ausente vira `null`.
4. **`summarizeTokens(receipts)`:**
   - considera só recibos com `tokens.source === "host-structured"`. Nenhum → `"not run"`;
   - senão: `in=<Σin> out=<Σout> cache=<Σcache|null> usd=<Σcost|null>`;
   - `null` em `in`/`out` conta como 0 na soma;
   - `cache`/`usd` ficam `null` só se todos forem `null`;
   - `usd` é `String(Number(sum.toFixed(6)))`.
5. **`evalPlan` (geração):**
   - task = pasta do plano; `receipts` = recibos da task no ledger (`--ledger` ou `defaultLedgerPath()`), por `seq`;
   - nenhum recibo → stderr `sem recibos para <task>`, exit 1, **não** escreve;
   - campos derivados:

     | Campo | Origem |
     |---|---|
     | `status` | último recibo |
     | `attempts` | `receipts.length` |
     | `minutes` | `Math.ceil(Σ evidence[].duration_ms / 60000)` |
     | `tokens` | `summarizeTokens(receipts)` |
     | `executor` | `author` do último recibo: `model ?? "desconhecido"`, `family ?? "desconhecida"` |
     | `planner` | `PINGA_PLANNER_MODEL ?? PLANNER_DEFAULT.model`, `PINGA_PLANNER_FAMILY ?? PLANNER_DEFAULT.family` |

   - **escopo**, ao vivo, com `findRedBase`, `changedFiles` e `alwaysAllowed` da T04, na raiz git do plano:
     - sem base → `{ tests_frozen: "sem base", out_of_touch: null }`;
     - senão: `ALTERADO` se `changed ∩ tests_frozen ≠ ∅`, e `out_of_touch` = `changed − touch − alwaysAllowed(task)`, ordenado;
   - **parecer:**
     - executor e planejador da mesma família (strings iguais, não nulas) → `"n/a: mesma família"`, sempre;
     - famílias diferentes → o parecer preservado do arquivo existente, se não vazio e diferente de `n/a: mesma família`; senão `"pendente"`;
   - **dono:** `bom`/`ruim`/`mudar` preservados do arquivo existente (`extractOwnerFields`); arquivo novo → `""`;
   - escreve `tasks/<task>/EVAL.md` (ao lado do plano) com `renderEval`, imprime o caminho absoluto no stdout, exit 0;
   - é idempotente: rodar duas vezes sem mudar o ledger dá bytes iguais.
6. **`--check`:**
   - nunca escreve;
   - arquivo ausente → stderr `EVAL.md ausente`, exit 1;
   - `validateEval(text, task)` falha → erros no stderr, exit 1;
   - válido → stdout `ok <caminho>`, exit 0.
7. **CLI:** `pinga eval <PLAN.md> [--ledger PATH] [--check]`. Sem plano, flag desconhecida ou `--ledger` sem valor → exit 2. A `USAGE` ganha a linha do `eval`.

## Casos

Repo git temporário com `tasks/TX/PLAN.md` (`touch: ["src/a.ts"]`, `tests_frozen: ["tests/a.test.ts"]`) e ledger temporário fora do repo. Os recibos são gravados direto com `openLedger(tmp).append(...)`, a partir de um recibo mínimo válido da T01. O CLI é chamado como `bun <ROOT>/bin/pinga.ts eval ...`, com `PINGA_PLANNER_*` removidos do env filho, salvo quando o caso diz o contrário.

1. Round-trip: `parseEval(renderEval(doc))` → `{ ok: true, doc }` igual, para:
   - `tokens: "not run"` e `out_of_touch: []`;
   - `tokens: "in=1 out=2 cache=null usd=0.5"` e `out_of_touch: ["README.md", "src/b.ts"]`;
   - `scope: { tests_frozen: "sem base", out_of_touch: null }`.
2. `renderEval` com dono vazio termina em `"dono:\n  bom:\n  ruim:\n  mudar:\n"`, e a 3ª linha começa com `"auto:   status "`.
3. `validateEval` rejeita:
   - sem cabeçalho;
   - `status passed`;
   - `tentativas 0`;
   - falta `  mudar:`;
   - linha extra no fim;
   - `tokens 0` (zero não é formato válido);
   - `tests_frozen talvez`;
   - além disso, `validateEval(texto de TX, "TY")` → erro.

   Um texto com 3 problemas devolve `errors.length >= 3`.
4. Compatibilidade: os arquivos `tasks/T00/EVAL.md` … `tasks/T03/EVAL.md` reais do repo (`<ROOT>/tasks/...`) passam em `validateEval(texto, "T0N")`.
5. `summarizeTokens`:
   - todos com `source: null` → `"not run"`;
   - dois recibos `host-structured`, com `{in:100,out:20,cache:null,cost:0.01}` e `{in:50,out:5,cache:3,cost:null}` → `"in=150 out=25 cache=3 usd=0.01"`;
   - `cost` 0.1 + 0.2 → `usd=0.3`.
6. Geração nova, com o ledger contendo TX:
   - `fail`, `duration_ms: 30000`;
   - `pass`, `duration_ms: 50000`, `author: { model: "glm-5.3", family: "glm" }`;
   - mais um recibo de TY.

   Sem commit RED. Resultado:
   - exit 0, e o stdout é o caminho de `tasks/TX/EVAL.md`;
   - o arquivo passa em `validateEval(_, "TX")`;
   - `status pass · tentativas 2 · tempo 2 min · tokens not run`;
   - `executor: glm-5.3 (glm) · planejador: gemini-4-argon (gemini)`;
   - `escopo: tests_frozen sem base · fora do touch: sem base`;
   - `parecer: pendente`;
   - dono vazio.
7. Mesma família: último recibo com `family: "gemini"` → `parecer: n/a: mesma família`. Com `PINGA_PLANNER_FAMILY=glm` e executor `glm` → também `n/a: mesma família`, e `planejador: gemini-4-argon (glm)`.
8. Preservação: `EVAL.md` existente com `auto` velho (`status fail · tentativas 9`), `parecer: código limpo`, `  bom:   rápido`, `  ruim:  verboso` e `  mudar: nada`, com executor `glm`. Depois do `eval`:
   - `auto` é regenerado do ledger;
   - `parecer: código limpo`, `bom: rápido`, `ruim: verboso` e `mudar: nada` ficam preservados.
9. Preservação tolerante: `EVAL.md` existente inválido (só `lixo\n  bom: x\n`) → regenerado válido com `bom` = `x`, `ruim` e `mudar` vazios, e `parecer: pendente`.
10. Mesma família com parecer antigo `código limpo` → vira `n/a: mesma família`.
11. Escopo com base:
    - commit `chore: init` com o plano, `src/a.ts` e `tests/a.test.ts`;
    - commit `test(TX): RED`;
    - depois: modificar `tests/a.test.ts`, criar `src/b.ts` e `tasks/TX/EXEC.md`;
    - resultado: `escopo: tests_frozen ALTERADO · fora do touch: src/b.ts, tests/a.test.ts`. `EXEC.md` e o próprio `EVAL.md` ficam de fora.
12. Sem recibos de TX → exit 1, stderr contém `sem recibos`, `tasks/TX/EVAL.md` não existe.
13. Idempotência: duas gerações seguidas → conteúdo byte a byte igual.
14. `--check`:
    - depois da geração → exit 0, stdout começa com `ok `, arquivo inalterado (mesmo sha256);
    - arquivo ausente → exit 1, `EVAL.md ausente`;
    - arquivo corrompido (`status passed`) → exit 1, o arquivo continua corrompido (byte a byte);
    - `## EVAL TY` dentro de `tasks/TX/` → exit 1.
15. CLI:
    - `pinga eval` sem plano → exit 2;
    - `pinga eval <plan> --ledger` sem valor → exit 2;
    - `pinga eval <plan> --xpto` → exit 2.
