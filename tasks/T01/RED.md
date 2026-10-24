# RED T01 — `tests/receipt.test.ts`

## API esperada (`src/receipt.ts`)

```ts
export const STATUSES = ["pass", "fail", "blocked", "not run"] as const;
export const REASON_CODES = ["command_failed", "plan_invalid", "budget", "breaker_same_failure",
  "scope_drift", "tests_frozen_changed", "same_family_judge", "infra", "not_executed"] as const;
export const MAX_RECEIPT_BYTES = 4096;
export const MAX_TEXT = 280;
export type Receipt = { /* campos abaixo */ };
export function validateReceipt(x: unknown):
  { ok: true; receipt: Receipt } | { ok: false; errors: string[] };
```

## Campos

**Obrigatórios:**
- `v: 1`
- `type: "task.receipt"`
- `id: string`
- `task: string`
- `status`: um de `STATUSES`
- `reason_code: string | null` (`null` se e somente se `status === "pass"`; elemento de `REASON_CODES` quando `status !== "pass"`)
- `attempts`: inteiro ≥ 1
- `evidence: Evidence[]`
- `tokens: { in, out, cache: inteiro ≥ 0 | null, source: "host-structured" | null }`
- `cost_usd: number | null`
- `cost_evidence: string`
- `author: { model: string | null, family: string | null }`
- `verified_by: { model, family } | null`
- `summary: string`
- `created_at`: string ISO 8601

**Opcionais** (são conhecidos, e validados se presentes):
- `flow: string` (não vazia)
- `mode_effective: string` (não vazia)
- `breaker: { tripped: boolean, failure_signature: string | null }`
- `checkpoint_ref: string` (não vazia)
- `next_action: string` (não vazia)
- `question: { text: string, options: string[] }`

Todos os objetos tipados (raiz, `tokens`, `author`, `verified_by`, `evidence[i]`, `artifact_ref`, `breaker`, `question`) rejeitam chaves desconhecidas.

**Formato de `Evidence`:**
- `kind: "command"`
- `cmd_sha256`: 64 caracteres hex
- `exit: inteiro | null`
- `duration_ms`: inteiro ≥ 0
- `artifact_ref: { path: string, sha256: 64 hex } | null`

## Casos

1. Recibo mínimo válido com `status: "pass"` e `reason_code: null` → `ok: true`.
2. `status: "passed"` → erro. `status: "not_run"` → erro (o valor certo é `"not run"`, com espaço).
3. `status: "pass"` com `reason_code` não nulo → erro.
4. `status: "fail"` com `reason_code: null` → erro. `status: "fail"` com `reason_code: "foo"` → erro. `status: "blocked"` ou `"not run"` com `reason_code: null` → erro.
5. Campo desconhecido na raiz (`extra: 1`) → erro que menciona `extra`. O mesmo vale dentro de `tokens` e dos demais sub-objetos.
6. `JSON.stringify(recibo)` com mais de 4096 bytes → erro (ex.: 30 evidências válidas).
7. `summary` com 281 caracteres → erro. Com 280 → ok. O mesmo vale para `question.text`.
8. `tokens.source: null` com `tokens.in: 0` → erro (zero inventado; I4). `source: null` com tudo `null` → ok.
9. `tokens.in: -1` ou `1.5` → erro.
10. `v: 2` → erro. `type: "task.request"` → erro.
11. `evidence[0].cmd_sha256` com 63 caracteres → erro.
12. `attempts: 0` → erro.
13. Os erros são acumulados: um recibo com 3 problemas devolve `errors.length >= 3`.
