# RED T08 — tests/judge.test.ts (+ `tests/receipt.test.ts`)

Só `bun:test` e built-ins do Bun 1.4.4 (`Bun.serve`, `Bun.spawn`, `fetch`, `node:fs`, `node:path`, `node:os`, `node:crypto`). Zero dependências npm (D4). O endpoint do juiz é um `Bun.serve({ port: 0 })` falso, no próprio processo do teste.

**Atenção:** os casos de CLI do `judge` chamam o `pinga` com `Bun.spawn` **assíncrono** e `await proc.exited`. Com `Bun.spawnSync` o servidor falso, que roda no mesmo processo, nunca responde.

O commit RED também altera `tests/receipt.test.ts`: a expectativa de `REASON_CODES` ganha `"judge_rejected"` e `"model_unattested"` no fim, nesta ordem (SPEC 0002 §4.1).

## API esperada

```ts
// src/family.ts
export const FAMILY_ALIASES: ReadonlyArray<readonly [prefix: string, family: string]>;
export function modelFamily(model: string | null | undefined): string;   // nunca "", vazio → "unknown"
export function normalizeServedId(rawId: string): string;                // porta de pi-harness/src/router/model_identity.ts
export type Attestation = { claimed: string | null; served: string; via: "/v1/models" | "transcript" };
export type AttestResult =
  | { ok: true; attested: Attestation }
  | { ok: false; reason_code: "infra" | "model_unattested"; error: string };
export function servedFromModels(body: unknown, claimed: string | null):
  | { ok: true; served: string }
  | { ok: false; reason_code: "infra" | "model_unattested"; error: string };   // pura
export function attestFromEndpoint(
  endpoint: string, claimed: string | null, opts?: { timeoutMs?: number },
): Promise<AttestResult>;
export function attestFromTranscript(text: string, claimed: string | null): AttestResult;  // pura

// src/judge.ts
export const JUDGE_EXIT = { pass: 0, judge_rejected: 1, same_family_judge: 7, infra: 8, model_unattested: 8 } as const;
export const JUDGE_PROMPT_VERSION = 1;
export function assertDistinctFamily(executorFamily: string | null, judgeFamily: string):
  | { ok: true }
  | { ok: false; reason_code: "same_family_judge" | "model_unattested" };
export function parseVerdict(content: string):
  | { ok: true; verdict: "pass" | "fail"; findings: string[] }
  | { ok: false; error: string };
export type JudgeOptions = {
  ledgerPath?: string; judgeModel?: string; endpoint?: string; base?: string; usageFile?: string;
};
export function judgePlan(planPath: string, opts?: JudgeOptions): Promise<number>;

// src/receipt.ts
//   REASON_CODES += "judge_rejected", "model_unattested" (no fim)
//   Receipt.model_attested?: Attestation
export function receiptKind(r: Pick<Receipt, "flow">): "verify" | "judge";   // flow === "judge" → "judge"

// src/cli.ts — runCli passa a devolver number | Promise<number>; bin/pinga.ts faz `await`
```

## Comportamento esperado

1. **`modelFamily(model)`**, nesta ordem:
   - `trim` + minúsculas; vazio, `null` ou `undefined` → `"unknown"`;
   - fica só o último segmento depois de `/` (`openrouter/qwen/qwen3.8-flash` → `qwen3.8-flash`);
   - remove sufixo `:<tag>` (`:free`, `:0`) e `.gguf`;
   - remove prefixo de provedor `^(?:(?:us|eu|apac|global)\.)?(?:anthropic|google|meta|mistral|amazon|openai)\.`;
   - `head` = primeiro token de `split(/[.\-_\s]/)`;
   - procura em `FAMILY_ALIASES`, na ordem; casa se `head === prefix` ou `head.startsWith(prefix)`, **exceto** `o1`, `o3`, `o4`, que exigem igualdade exata:

     | Família | Prefixos |
     |---|---|
     | `claude` | `claude`, `opus`, `sonnet`, `haiku` |
     | `gemini` | `gemini`, `gemma` |
     | `gpt` | `gpt`, `chatgpt`, `codex`, `o1`, `o3`, `o4` |
     | `qwen` | `qwen`, `qwq` |
     | `deepseek` | `deepseek` |
     | `glm` | `glm`, `chatglm`, `zhipu` |
     | `minimax` | `minimax`, `abab` |
     | `kimi` | `kimi`, `moonshot` |
     | `llama` | `llama`, `meta` |
     | `mistral` | `mistral`, `mixtral`, `codestral`, `devstral`, `magistral` |
     | `ornith`, `mimo`, `longcat` | o próprio nome |

   - nenhum casa → `head` (ou `"unknown"` se vazio).
2. **`normalizeServedId`**: igual ao do pi-harness: último segmento de `/`, sem `.gguf`, remove repetidamente o sufixo `-(I?Q\d[\w]*|F16|BF16|F32)$` (sem diferenciar maiúsculas), minúsculas.
3. **`servedFromModels(body, claimed)`** (formato OpenAI do llama-server):
   - `ids` = `body.data[].id` strings, normalizadas; se `body.data` não existe, usa `body.models[].model`;
   - `body` não é objeto, ou nenhum dos dois arrays existe → `infra`, `error` contém `resposta /v1/models inválida`;
   - `ids` vazio → `model_unattested`;
   - `claimed` não nulo e `normalizeServedId(claimed) ∈ ids` → `served = normalizeServedId(claimed)`;
   - senão, exatamente 1 id → `served = ids[0]` (**alias falso**: `served ≠ claimed` é aceito, e a família passa a ser a do servido);
   - senão → `model_unattested`, `error` contém `ambíguo`.
4. **`attestFromEndpoint`**: `GET <endpoint sem / final>/v1/models` com `AbortSignal.timeout(opts.timeoutMs ?? 5000)`. Erro de rede, timeout, status ≠ 2xx ou JSON inválido → `{ ok: false, reason_code: "infra" }`. Senão, `servedFromModels`; ok → `{ claimed, served, via: "/v1/models" }`.
5. **`attestFromTranscript(text, claimed)`** (transcript do executor, o mesmo `--usage-file` da T06):
   - linhas JSON inválidas são puladas;
   - modelo da linha = `message.model` ou `model` na raiz, string não vazia e ≠ `"<synthetic>"`, em minúsculas;
   - nenhum modelo → `model_unattested`, `error` contém `transcript sem modelo`;
   - modelos de mais de uma família (`modelFamily`) → `model_unattested`, `error` contém `várias famílias`;
   - `served` = o modelo com mais linhas; empate → o menor em ordem lexicográfica; `via: "transcript"`.
6. **`assertDistinctFamily`**: executor `null`, `""` ou `"unknown"` → `model_unattested`; famílias iguais → `same_family_judge`; senão ok.
7. **`parseVerdict(content)`**: remove cercas ```` ``` ````/```` ```json ````; pega do primeiro `{` ao último `}`; `JSON.parse`. Válido só se for objeto com `verdict` exatamente `"pass"` ou `"fail"` e `findings` ausente (→ `[]`) ou array de strings.
8. **`judgePlan(planPath, opts)`**, nesta ordem (nenhum passo pula para o seguinte em erro):
   1. plano inválido → stderr com o erro, exit 3, **sem** recibo;
   2. `last` = último recibo da task com `receiptKind === "verify"`. Ausente ou `status ≠ "pass"` → stderr `nada a julgar: último verify de <task> não é pass`, exit 1, **sem** recibo;
   3. base = `opts.base` (validada como na T04: inválida → exit 2) ?? `findRedBase`; nenhuma → stderr `sem base para o diff`, exit 2, sem recibo;
   4. **executor**: `claimed = last.author.model`. Com transcript (`opts.usageFile ?? PINGA_USAGE_FILE`, legível) e `attestFromTranscript` ok → modelo = `served`; senão modelo = `claimed`. Família = `modelFamily(modelo)` se houver modelo, senão `last.author.family`;
   5. **juiz**: `claimed = opts.judgeModel ?? PINGA_JUDGE_MODEL ?? null`; endpoint = `opts.endpoint ?? PINGA_JUDGE_ENDPOINT ?? "http://127.0.0.1:8089"`; `attestFromEndpoint`;
   6. `assertDistinctFamily(executor, modelFamily(served))`;
   7. só então `POST <endpoint>/v1/chat/completions` com `{ model: served, temperature: 0, messages: [system, user] }` e timeout `PINGA_JUDGE_TIMEOUT_MS ?? 120000`. A mensagem `user` contém o `goal`, o `done_when` e o `git diff --no-renames <base>` (tracked, base → árvore atual), cortado em `PINGA_JUDGE_MAX_DIFF_BYTES ?? 48000` bytes com o marcador `[diff cortado em <n> bytes]`. O texto do system é fixo e inclui `JUDGE_PROMPT_VERSION`;
   8. `parseVerdict(choices[0].message.content)`.
9. **Artefato:** a cada chamada do passo 7, `runs/<task>/judge-<n>.json` (`n` = 1 + recibos `judge` da task), com `canonicalJson({ request, response_content })`.
10. **Recibo** (sempre `flow: "judge"`, `attempts = last.attempts`, vai pro ledger e pro stdout, passa no `validateReceipt`):

    | Situação | status / reason_code | exit | `verified_by` | `model_attested` |
    |---|---|---|---|---|
    | veredito `pass` | `pass` / `null` | 0 | `{ model: served, family }` | sim |
    | veredito `fail` | `fail` / `judge_rejected` | 1 | `{ model: served, family }` | sim |
    | mesma família (passo 6) | `blocked` / `same_family_judge` | 7 | `null` | sim |
    | executor sem família (passo 6) | `blocked` / `model_unattested` | 8 | `null` | se atestado |
    | `/v1/models` ambíguo ou vazio | `blocked` / `model_unattested` | 8 | `null` | ausente |
    | rede, HTTP ≠ 2xx, timeout, resposta sem veredito | `not run` / `infra` | 8 | `null` | se atestado |

    - **I10:** executor sem família é detectado **antes** de qualquer chamada de rede; mesma família, antes da chamada do chat;
    - `author = { model: <modelo do executor>, family: <família do executor> }`;
    - `evidence`: com chamada ao chat, `[{ kind: "command", cmd_sha256: sha256(canonicalJson(request)), exit: pass ? 0 : fail ? 1 : null, duration_ms, artifact_ref }]`; sem chamada, `[]`;
    - `tokens`: `usage.prompt_tokens`/`completion_tokens` inteiros da resposta → `{ in, out, cache: null, source: "host-structured" }`, `cost_usd: null`, `cost_evidence: "judge-response:<sha256 do artefato>"`; senão `NOT_RUN_TOKENS`;
    - `summary` (cortado em 280):
      - pass: `` `${task} pass: juiz ${served} (${fam}) aprovou` ``;
      - fail: `` `${task} fail: juiz ${served} (${fam}) reprovou (${k} achados)` ``;
      - mesma família: `` `${task} blocked: juiz ${served} é da mesma família do executor (${fam})` ``;
      - executor sem família: `` `${task} blocked: família do executor desconhecida` ``;
      - juiz não atestado: `` `${task} blocked: modelo do juiz não atestado (${error})` ``;
      - infra: `` `${task} not run: juiz indisponível (${error})` ``.
11. **`receiptKind` nos consumidores:** `lastReceiptFor` (T05) ignora recibos `judge`. No `evalPlan` (T07), `status`, `attempts` e `minutes` vêm só dos recibos `verify`; `tokens` soma **todos** (o custo do juiz entra na Lei 1); se existe recibo `judge`, `parecer` = `summary` do último recibo `judge`, **acima** da regra "n/a: mesma família" da T07.
12. **`model_attested` no `validateReceipt`:** objeto com exatamente `claimed` (string não vazia ou `null`), `served` (string não vazia) e `via` (`"/v1/models"` ou `"transcript"`). Chave extra → `unknown field: model_attested.<chave>`.
13. **CLI:** `pinga judge <PLAN.md> [--ledger PATH] [--judge-model M] [--endpoint URL] [--base SHA] [--usage-file PATH]`. Sem plano, flag desconhecida ou flag sem valor → exit 2. A `USAGE` ganha a linha do `judge`.

## Casos

Unitários (sem rede):

1. `modelFamily`:

   | Entrada | Família |
   |---|---|
   | `claude-opus-5-5`, `Claude-Sonnet-5-5`, `us.anthropic.claude-haiku-5-5-v1:0`, `anthropic/claude-fable-5-1`, `opus` | `claude` |
   | `gemini-4-argon`, `models/gemini-3.8-flash`, `gemma-3-27b` | `gemini` |
   | `gpt-6-luna`, `openai/gpt-5`, `o3-mini`, `codex-2` | `gpt` |
   | `qwen3.5-4b`, `Qwen3.5-4B-Q4_K_M.gguf`, `openrouter/qwen/qwen3.8-flash:free`, `qwq-32b` | `qwen` |
   | `deepseek-v4-pro` · `glm-5.3-flash-free` · `minimax-m3.1-flash-free` · `kimi-k3`, `moonshot-v1` · `mixtral-8x7b` | `deepseek` · `glm` · `minimax` · `kimi` · `mistral` |
   | `ornith-9b-local` · `laguna-s-2.1:free` · `omni-x` | `ornith` · `laguna` · `omni` (não `gpt`) |
   | `""`, `"   "`, `null`, `undefined` | `unknown` |

2. `normalizeServedId`: `/models/Qwen3.5-4B-Q4_K_M.gguf` → `qwen3.5-4b`; `qwen3.5-4b-F16` → `qwen3.5-4b`; `x-IQ4_XS` → `x`.
3. `servedFromModels`:
   - `{ data: [{ id: "qwen3.5-4b" }] }` com claimed `ornith-9b-local` → ok, `served: "qwen3.5-4b"` (alias falso detectado);
   - `{ data: [{ id: "/m/Qwen3.5-4B-Q4_K_M.gguf" }] }`, claimed `null` → `qwen3.5-4b`;
   - `{ data: [{ id: "a" }, { id: "qwen3.5-4b" }] }`, claimed `qwen3.5-4b` → `qwen3.5-4b`;
   - `{ data: [{ id: "a" }, { id: "b" }] }`, claimed `c` ou `null` → `model_unattested`, `ambíguo`;
   - `{ models: [{ model: "/m/Qwen3.5-4B.gguf" }] }` → `qwen3.5-4b`;
   - `{ data: [] }` → `model_unattested`; `"x"` e `{}` → `infra`.
4. `attestFromTranscript`:
   - 3 linhas `message.model: "claude-opus-5-5"`, 1 linha `"claude-haiku-5-5"`, 1 `"<synthetic>"` e 1 linha `{oops` → ok, `served: "claude-opus-5-5"`, `via: "transcript"`;
   - empate entre `b-model` e `a-model` da mesma família `x` → `a-model`;
   - `claude-opus-5-5` + `qwen3.8-flash` → `model_unattested`, `várias famílias`;
   - só linhas `user` → `model_unattested`, `transcript sem modelo`.
5. `assertDistinctFamily`: `("claude","qwen")` ok; `("claude","claude")` → `same_family_judge`; `(null,"qwen")`, `("","qwen")`, `("unknown","qwen")` → `model_unattested`.
6. `parseVerdict`:
   - `{"verdict":"pass"}` → pass, `findings: []`;
   - com cerca ```` ```json ```` e prosa antes e depois → ok;
   - `{"verdict":"fail","findings":["a","b"]}` → fail, 2 achados;
   - `{"verdict":"PASS"}`, `{"verdict":"ok"}`, `não sei`, `{"verdict":"pass","findings":[1]}` → `ok: false`.
7. `validateReceipt` com `model_attested`: `{ claimed: "ornith-9b-local", served: "qwen3.5-4b", via: "/v1/models" }` ok; `claimed: null` ok; `via: "config"` → erro; `served: ""` → erro; chave `extra` → erro com `model_attested.extra`.
8. `receiptKind`: `{ flow: "judge" }` → `judge`; `{}` e `{ flow: "awaiting_judge" }` → `verify`.
9. `lastReceiptFor` com o ledger recebendo TX `fail` (verify), TX `pass` (`flow: "judge"`) → devolve o `fail`.

CLI. Repo git temporário com `tasks/TX/PLAN.md` (`touch: ["src/a.ts"]`, `tests_frozen: ["tests/a.test.ts"]`, goal `meta do TX`), commits `chore: init` e `test(TX): RED`, depois um commit que altera `src/a.ts`. Ledger temporário fora do repo com um recibo `verify` `pass` de TX, `attempts: 1`, `author: { model: "claude-opus-5-5", family: "claude" }`, gravado com `openLedger(tmp).append`. Servidor falso: `/v1/models` e `/v1/chat/completions` configuráveis por caso; conta as requisições de cada rota e guarda o último corpo do chat. Por padrão: `/v1/models` → `{ data: [{ id: "qwen3.5-4b" }] }`; chat → `{ choices: [{ message: { content: "{\"verdict\":\"pass\",\"findings\":[]}" } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }`. Env filho sem `PINGA_JUDGE_*` e sem `PINGA_USAGE_FILE`, salvo quando o caso diz o contrário.

10. Pass com alias falso: `--judge-model ornith-9b-local --endpoint <fake>` →
    - exit 0; recibo `flow: "judge"`, `pass`, `reason_code: null`, `attempts: 1`;
    - `verified_by: { model: "qwen3.5-4b", family: "qwen" }`, `author.family === "claude"`;
    - `model_attested: { claimed: "ornith-9b-local", served: "qwen3.5-4b", via: "/v1/models" }`;
    - o corpo do chat tem `model: "qwen3.5-4b"` (o servido, não o alegado) e `temperature: 0`; a mensagem `user` contém `meta do TX` e `src/a.ts`;
    - `tokens: { in: 100, out: 10, cache: null, source: "host-structured" }`;
    - `runs/TX/judge-1.json` existe e seu sha256 é o `evidence[0].artifact_ref.sha256`;
    - `validateReceipt` ok.
11. Veredito `fail` com 2 achados → exit 1, `fail`/`judge_rejected`, `verified_by` preenchido, `summary` contém `reprovou (2 achados)`.
12. Mesma família: `/v1/models` → `claude-haiku-5-5` → exit 7, `blocked`/`same_family_judge`, `verified_by: null`, `model_attested.served === "claude-haiku-5-5"`, **0** requisições ao chat.
13. Fraude de alias pega pela família: executor `{ model: "qwen3.8-flash", family: "qwen" }`, `--judge-model ornith-9b-local`, servidor com `data: [{ id: "/m/Qwen3.5-4B-Q4_K_M.gguf" }]` → exit 7, 0 requisições ao chat.
14. Executor desconhecido: `author: { model: null, family: null }` e sem transcript → exit 8, `blocked`/`model_unattested`, `summary` contém `família do executor desconhecida`, **0** requisições em qualquer rota.
15. Transcript vence a config: `author` alega `{ model: "gemini-3.8-flash", family: "gemini" }`, `--usage-file` com linhas `message.model: "claude-opus-5-5"`:
    - servidor com `claude-haiku-5-5` → exit 7 (pela alegação, seria gemini ≠ claude e passaria);
    - servidor com `qwen3.5-4b` → exit 0 e `author: { model: "claude-opus-5-5", family: "claude" }`.
16. Endpoint fora: `--endpoint http://127.0.0.1:<porta fechada>` → exit 8, `not run`/`infra`, `summary` contém `indisponível`, sem `model_attested`.
17. `/v1/models` ambíguo (`a`, `b`) sem `--judge-model` → exit 8, `blocked`/`model_unattested`, 0 requisições ao chat.
18. Chat com HTTP 500 → exit 8, `not run`/`infra`. Chat com `content: "não sei"` → exit 8, `not run`/`infra`, e `runs/TX/judge-<n>.json` existe.
19. Nada a julgar: último recibo `verify` de TX é `fail` → exit 1, stderr contém `nada a julgar`, o ledger mantém o número de linhas. Sem recibos de TX → idem.
20. Determinismo: dois `judge` seguidos no mesmo estado → os dois exit 0, `judge-1.json` e `judge-2.json` existem, os dois `evidence[0].cmd_sha256` são iguais, e `lastReceiptFor(ledger, "TX")` continua sendo o recibo `verify`.
21. Diff cortado: `PINGA_JUDGE_MAX_DIFF_BYTES=10` → a mensagem `user` contém `[diff cortado em 10 bytes]`.
22. `eval` depois do caso 10 (`bun <ROOT>/bin/pinga.ts eval <plan> --ledger <tmp>`):
    - `status pass · tentativas 1` (o recibo `judge` não conta);
    - `tokens in=100 out=10 cache=null usd=null`;
    - `parecer:` contém `juiz qwen3.5-4b (qwen) aprovou`;
    - `validateEval(_, "TX")` ok.
23. CLI: `pinga judge` sem plano → exit 2; `--endpoint` sem valor → exit 2; `--xpto` → exit 2; `--base nope` → exit 2, stderr contém `base inválida`.
24. Integração: todo recibo impresso nos casos 10–21 passa no `validateReceipt`, e `pinga ledger verify --ledger <tmp>` dá `ok <n>`.
