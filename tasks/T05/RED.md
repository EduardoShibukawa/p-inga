# RED T05 — tests/breaker.test.ts

Só `bun:test` e built-ins do Bun 1.4.4 (`Bun.spawnSync`, `node:crypto`, `node:fs`, `node:path`, `node:os`). Zero dependências npm (D4).

## API esperada

```ts
// src/breaker.ts
import type { Ledger } from "./ledger";
import type { ReasonCode, Receipt } from "./receipt";

export const BREAKER_EXIT = 4;
export const BREAKER_NEXT_ACTION = "escalar ao dono";

export type FailureInput = {
  exit: number | null;
  out_sha256: string | null;
  reason_code: ReasonCode | null;
};
export function computeFailureSignature(f: FailureInput): string;
//   sha256hex(canonicalJson({ exit: f.exit, out_sha256: f.out_sha256, reason_code: f.reason_code }))
export function lastReceiptFor(ledger: Ledger, task: string): Receipt | null;
//   JSON.parse(body) da linha de maior seq com row.task === task; null se não houver
export function shouldTrip(prev: Receipt | null, signature: string): boolean;
//   true se prev.status ∈ {"fail","blocked"} e prev.breaker?.failure_signature === signature
```

## Comportamento esperado

1. **Escopo do disjuntor:** só quando o `done_when` rodou, terminou sem timeout e saiu com exit ≠ 0. Pass, timeout (`budget`), `plan_invalid` e bloqueios de guarda (T04) **não** ganham o campo `breaker` e seguem a T03/T04.
2. **Assinatura:**
   ```ts
   computeFailureSignature({
     exit: <exit do done_when>,
     out_sha256: <sha256 de out.txt>,  // o mesmo do artifact_ref
     reason_code: "command_failed",    // sempre o reason candidato, antes de armar
   })
   ```
   A normalização é o `canonicalJson` da T02: a ordem das chaves não importa.
3. **Decisão:** antes de gravar, `prev = lastReceiptFor(ledger, task)`.
   - `shouldTrip(prev, sig)` → disjuntor **arma**:
     - `status: "blocked"`, `reason_code: "breaker_same_failure"`;
     - `breaker: { tripped: true, failure_signature: sig }`;
     - `next_action: "escalar ao dono"`;
     - `summary`: `` `${task} blocked: disjuntor armado, mesma falha 2x seguidas (exit ${exit}); escalar ao dono` ``, cortado em 280;
     - exit do `pinga`: **4**.
   - senão:
     - `status: "fail"`, `reason_code: "command_failed"`;
     - `breaker: { tripped: false, failure_signature: sig }`;
     - `summary` da T03;
     - exit **1**.
4. **Evidência preservada:** o recibo armado mantém `evidence[0]` completo (`exit`, `duration_ms`, `artifact_ref`). O `done_when` roda normalmente; o disjuntor só decide o veredito.
5. **Recibos antigos** (sem `breaker`, da T03) nunca armam.
6. **Recibo armado conta como falha:** uma 3ª tentativa idêntica arma de novo.
7. **Tarefas distintas** no mesmo ledger não se influenciam: vale só o último recibo **da mesma task**.

## Casos

Repo git temporário (`mkdtemp` + `git init`, **sem** commit RED, então as guardas da T04 são puladas) com `tasks/TX/PLAN.md` e ledger temporário fora do repo. O CLI é chamado como `bun <ROOT>/bin/pinga.ts verify <plan> --ledger <tmp>`.

1. `computeFailureSignature`:
   - é determinística e tem 64 hex;
   - é igual a `sha256hex(canonicalJson({ reason_code, out_sha256, exit }))`, com as chaves em qualquer ordem;
   - muda quando muda `exit`, `out_sha256` ou `reason_code`.
2. `shouldTrip`:
   - `null` → false;
   - prev `pass` → false;
   - prev `fail` com `breaker.failure_signature === sig` → true;
   - prev `fail` com outra assinatura → false;
   - prev `fail` sem `breaker` → false;
   - prev `blocked` com `breaker: { tripped: true, failure_signature: sig }` → true;
   - prev `blocked`/`budget` sem `breaker` → false.
3. `lastReceiptFor`, com o ledger recebendo TX, TY e TX (recibos válidos montados à mão):
   - devolve o 3º recibo para `"TX"` e o 2º para `"TY"`;
   - `"TZ"` → `null`.
4. `done_when: "echo boom; exit 7"` uma vez →
   - exit 1, `fail`, `command_failed`;
   - `breaker.tripped === false`;
   - `breaker.failure_signature === computeFailureSignature({ exit: 7, out_sha256: evidence[0].artifact_ref.sha256, reason_code: "command_failed" })`.
5. Mesmo plano, 2ª vez →
   - exit 4, `blocked`, `breaker_same_failure`;
   - `breaker.tripped === true`, com a mesma assinatura do caso 4;
   - `next_action === "escalar ao dono"`, `summary` contém `disjuntor`;
   - `attempts === 2`;
   - `evidence[0].exit === 7` e `artifact_ref` aponta para `runs/TX/2/out.txt`.
6. 3ª vez → exit 4 de novo.
7. Saída variável: `done_when: "n=$(cat c 2>/dev/null || echo 0); echo $((n+1)) > c; echo $n; exit 1"` duas vezes → as duas com exit 1, `tripped: false`, e as assinaturas diferem.
8. Exit diferente com a mesma saída: `exit 3` e depois `exit 4` (trocando o plano entre as runs) → os dois com exit 1, sem armar.
9. Pass no meio: `exit 7` (exit 1) → `true` (exit 0; recibo **sem** `breaker`) → `exit 7` → exit 1, `tripped: false`.
10. Outra task no meio: TX `exit 7` → TY `exit 7` (mesmo ledger) → TX `exit 7` → exit 4. TY sozinho continua com 1 falha.
11. Timeout repetido: `sleep 5` com `PINGA_TIMEOUT_MS=200` duas vezes → as duas com exit 2, `blocked`/`budget`, sem campo `breaker`.
12. Integração: todo recibo impresso nos casos 4–11 passa no `validateReceipt`, e `pinga ledger verify --ledger <tmp>` dá `ok <n>`.
