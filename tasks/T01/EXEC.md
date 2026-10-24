Você é o EXECUTOR da T01 (opencode opencode/glm-5.3-flash-free) no repo /home/shibuka/Projetos/duh-homelab/p-inga.

== 1. REGRAS DO EXECUTOR ==
- O commit RED já existe no commit `5c42862` (`test(T01): RED schema e validador do recibo v1`). Você faz **só o GREEN**.
- No GREEN, só crie ou edite arquivos listados em `touch`:
  `touch`: `["src/receipt.ts"]`
- Nunca edite arquivos de `tests_frozen`:
  `tests_frozen`: `["tests/receipt.test.ts"]` (nem `tests/repo.test.ts`).
- Nunca `git add .`/`-A`: sempre caminhos explícitos (`git add src/receipt.ts`). Nunca `--no-verify`. Nunca push.
- Nenhuma dependência npm (sem `zod` etc.). Só TypeScript puro e built-ins do Bun 1.4.4 (`Buffer.byteLength(JSON.stringify(x), "utf8")` para medir bytes UTF-8).
- Disjuntor manual: se o `done_when` falhar duas vezes seguidas com a mesma saída e você não tiver informação nova, PARE e reporte as duas saídas. Não tente uma terceira vez.
- Não declare "passou" sem colar a saída real do `done_when`. Status só em `pass`, `fail`, `blocked` ou `not run`.
- Não toque em nada fora de `/home/shibuka/Projetos/duh-homelab/p-inga`. Não adicione `tasks/T01/EXEC.md` no commit.

== 2. CONTRATO DA T01 (`src/receipt.ts`) ==
Leia `tasks/T01/PLAN.md`, `tasks/T01/RED.md` e `tests/receipt.test.ts` inteiros.

Assinatura esperada em `src/receipt.ts`:

```ts
export const STATUSES = ["pass", "fail", "blocked", "not run"] as const;
export const REASON_CODES = [
  "command_failed",
  "plan_invalid",
  "budget",
  "breaker_same_failure",
  "scope_drift",
  "tests_frozen_changed",
  "same_family_judge",
  "infra",
  "not_executed",
] as const;
export const MAX_RECEIPT_BYTES = 4096;
export const MAX_TEXT = 280;

export type Status = (typeof STATUSES)[number];
export type ReasonCode = (typeof REASON_CODES)[number];

export type ArtifactRef = {
  path: string;
  sha256: string; // 64 hex
};

export type Evidence = {
  kind: "command";
  cmd_sha256: string; // 64 hex (/^[0-9a-f]{64}$/i)
  exit: number | null; // inteiro ou null
  duration_ms: number; // inteiro >= 0
  artifact_ref: ArtifactRef | null;
};

export type Receipt = {
  v: 1;
  type: "task.receipt";
  id: string;
  task: string;
  status: Status;
  reason_code: ReasonCode | null;
  attempts: number; // inteiro >= 1
  evidence: Evidence[];
  tokens: {
    in: number | null;
    out: number | null;
    cache: number | null;
    source: "host-structured" | null;
  };
  cost_usd: number | null;
  cost_evidence: string;
  author: {
    model: string | null;
    family: string | null;
  };
  verified_by: {
    model: string | null;
    family: string | null;
  } | null;
  summary: string; // <= 280 chars
  created_at: string; // ISO 8601
  flow?: string;
  mode_effective?: string;
  breaker?: {
    tripped: boolean;
    failure_signature: string | null;
  };
  checkpoint_ref?: string;
  next_action?: string;
  question?: {
    text: string; // <= 280 chars
    options: string[];
  };
};

export function validateReceipt(
  x: unknown,
): { ok: true; receipt: Receipt } | { ok: false; errors: string[] };
```

Regras críticas de validação (acumule todos os erros em `errors: string[]`):
1. `x` deve ser objeto plano (não-nulo, não-array).
2. `Buffer.byteLength(JSON.stringify(x), "utf8") <= MAX_RECEIPT_BYTES` (4096).
3. **Chaves desconhecidas proibidas** na raiz e em TODOS os sub-objetos (`tokens`, `author`, `verified_by`, cada item de `evidence`, `artifact_ref`, `breaker`, `question`). A mensagem de erro DEVE incluir o nome da chave desconhecida (ex.: `"unknown field: extra"`).
4. `v === 1` e `type === "task.receipt"`.
5. `id`, `task`, `cost_evidence` são `string` não vazias.
6. `status` pertence a `STATUSES`.
7. `reason_code`: se `status === "pass"`, deve ser `null`; se `status !== "pass"`, deve pertencer a `REASON_CODES` (não pode ser `null` nem string fora de `REASON_CODES`).
8. `attempts`: `Number.isInteger(attempts) && attempts >= 1`.
9. `evidence`: array de objetos `Evidence` (`kind === "command"`, `cmd_sha256` `/^[0-9a-f]{64}$/i`, `exit === null || Number.isInteger(exit)`, `Number.isInteger(duration_ms) && duration_ms >= 0`, `artifact_ref === null` ou `{ path: string não vazia, sha256: 64 hex }`).
10. `tokens`:
    - `source` é `"host-structured"` ou `null`.
    - Se `source === null`, então `in`, `out` e `cache` DEVEM ser todos `null` (qualquer número como `0` com `source: null` é erro — Invariante I4).
    - Se `source === "host-structured"`, cada um de `in`, `out`, `cache` deve ser `null` ou inteiro `>= 0` (`Number.isInteger(n) && n >= 0`).
11. `cost_usd`: `null` ou `typeof cost_usd === "number" && Number.isFinite(cost_usd) && cost_usd >= 0`.
12. `author`: `{ model: string | null, family: string | null }`.
13. `verified_by`: `null` ou `{ model: string | null, family: string | null }`.
14. `summary`: `typeof summary === "string" && summary.length > 0 && summary.length <= MAX_TEXT` (280).
15. `created_at`: string ISO 8601 válida (`typeof s === "string" && !Number.isNaN(Date.parse(s))`).
16. Opcionais se presentes (`!== undefined`):
    - `flow`, `mode_effective`, `checkpoint_ref`, `next_action`: `typeof v === "string" && v.length > 0`.
    - `breaker`: `{ tripped: boolean, failure_signature: string | null }`.
    - `question`: `{ text: string (1..280 chars), options: string[] }`.

== 3. VERIFICAÇÃO E COMMIT ==
1. Rode o `done_when` exato:
   `bun test tests/receipt.test.ts`
2. Rode a suíte inteira:
   `bun test`
3. Confirme que os testes congelados não mudaram:
   `git diff 5c42862..HEAD -- tests/receipt.test.ts` (vazio)
4. Faça o commit GREEN (use `mise exec pkl@0.32.1 -- git commit ...` para que o hook `hk` encontre `pkl`):
   ```bash
   git add src/receipt.ts
   mise exec pkl@0.32.1 -- git commit -m "feat(T01): schema do recibo v1 e validador" -m "Co-Authored-By: glm-5.3-flash-free <noreply@zhipuai.com>"
   ```

== 4. FIM OBRIGATÓRIO ==
Ao terminar, cole na sua resposta final:
1. A saída real de `bun test tests/receipt.test.ts` e `bun test`
2. O sha do commit GREEN (`git rev-parse --short HEAD`)
3. A saída de `git diff --stat 5c42862..HEAD`
Depois PARE imediatamente.
