# RED T14 — tests/redact.test.ts + tests/learn.test.ts (+ `testdata/secrets/fake-token.txt`)

Só `bun:test` e built-ins do Bun 1.4.4 (`bun:sqlite`, `Bun.spawnSync`, `node:fs`, `node:path`, `node:os`, `node:crypto`). Zero dependências npm (D4).

**Isolamento (SPEC 0003 I16/I19):** todo caso usa `learn.db`, ledger, diretórios de EVAL e de sessões em `mkdtemp(join(realpath(tmpdir()), "pinga-t14-"))`; o env do `spawn` tem `HOME`, `XDG_STATE_HOME` e `PINGA_LEARN_DB` temporários (helper `runPinga` da T12). Nenhum caso lê `~/.claude`, `~/.pi`, `~/.hermes` nem qualquer arquivo de credencial real; a denylist dos testes é feita de hashes de valores sintéticos.

**Higiene da fonte:** nenhum segredo sintético aparece literal em `src/`, `tests/`, `specs/` ou `tasks/`. Os testes leem a fixture ou montam os valores por concatenação (como abaixo); `src/redact.ts` monta o canário do mesmo jeito. O caso 9 cobra isso.

`REASON_CODES` não muda (SPEC 0003 §4.1).

## Fixture `testdata/secrets/fake-token.txt`

Vai num commit **anterior** ao RED, `test(T14): fixture fake-token` (SPEC 0003 §7.2). Dez linhas, `\n` final; aqui em notação de concatenação (o arquivo tem os valores já juntos):

| Linha | Conteúdo | Saída esperada de `redact` | Kind |
|---|---|---|---|
| 1 | `# fixture sintética (T14): nenhum valor aqui é credencial real` | igual | — |
| 2 | `"ANTHROPIC_API_KEY=" + "sk-ant-api03-" + "FAKE".repeat(10) + "-AAAA"` | `ANTHROPIC_API_KEY=[REDACTED:anthropic]` | `anthropic` |
| 3 | `"GITHUB_TOKEN=" + "ghp_" + "FAKE".repeat(9)` | `GITHUB_TOKEN=[REDACTED:github]` | `github` |
| 4 | `"aws_access_key_id = " + "AKIA" + "FAKE".repeat(4)` | `aws_access_key_id = [REDACTED:aws]` | `aws` |
| 5 | `"Authorization: Bearer " + "eyJhbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiJmYWtlIn0" + "." + "ZmFrZS1zaWduYXR1cmU"` | `Authorization: Bearer [REDACTED:jwt]` | `jwt` |
| 6–8 | `"-----BEGIN OPENSSH " + "PRIVATE KEY-----"`, `RkFLRS1QUklWQVRFLUtFWS1CT0RZ`, `"-----END OPENSSH " + "PRIVATE KEY-----"` | uma linha só: `[REDACTED:private_key]` | `private_key` |
| 9 | `"remote = https://deploy:" + "hunter2" + "@git.example.invalid/repo.git"` | `remote = https://[REDACTED:url_credentials]@git.example.invalid/repo.git` | `url_credentials` |
| 10 | `"session_secret=" + "Zq8vR2mX7kLp" + "4Wn9Tb3Yc6Hd" + "1Jf5Gs0Ae"` | `session_secret=[REDACTED:entropy]` | `entropy` |

## API esperada

```ts
// src/redact.ts
export const REDACT_KINDS = ["anthropic", "github", "aws", "jwt", "private_key", "url_credentials",
  "denylist", "entropy"] as const;
export type RedactKind = (typeof REDACT_KINDS)[number];
export const ENTROPY_MIN_BITS = 4.0;
export const ENTROPY_MIN_LEN = 24;
export const EXCERPT_MAX = 300;
export function shannonEntropy(s: string): number;                // bits/char; "" → 0
export function redact(text: string, opts?: { denylist?: ReadonlySet<string> }):
  { text: string; findings: Array<{ kind: RedactKind; line: number }> };   // line 1-based no texto de entrada
export function loadDenylist(path: string): Set<string>;            // 64 hex por linha; vazias e "#…" ignoradas; outra coisa → lança
export function canary(): string[];                                 // segredos sintéticos montados em runtime (os 7 da fixture)
export function canaryCheck(values?: readonly string[], opts?: { denylist?: ReadonlySet<string> }):
  { ok: true } | { ok: false; survivors: number };                  // nunca devolve os valores
export function clip(text: string, max?: number): string;           // corta em max (padrão EXCERPT_MAX) chars
export function redactExcerpt(text: string | null, opts?: { denylist?: ReadonlySet<string> }): string | null; // redact → clip; "" → null

// src/transcript.ts
export const TEST_CMD_RE: RegExp;
export const EDIT_TOOLS: readonly string[];                         // ["Edit", "MultiEdit", "Write", "NotebookEdit"]
export type TranscriptSummary = {
  session_id: string | null; cwd: string | null; started_at: string | null; ended_at: string | null;
  model: string | null; verification: "pass" | "fail" | "none" | "not run";
  verification_evidence: string | null; rework_cycles: number; commits: number; excerpt_source: string | null;
};
export function parseClaudeTranscript(text: string): TranscriptSummary;   // pura
export function repoFromCwd(cwd: string | null): string | null;

// src/learn.ts
export const LEARN_SCHEMA_VERSION = 1;
export const LEARN_EXIT = { ok: 0, usage: 2, infra: 8, redaction_canary: 15 } as const;
export const SESSION_COLUMNS: readonly string[];                    // ordem do CREATE TABLE abaixo
export function defaultLearnDbPath(env?: Record<string, string | undefined>): string;
export function openLearnDb(path: string): import("bun:sqlite").Database;
export type IngestOptions = { db: string; ledger?: string; evals?: string; sessions?: string; repo?: string;
  denylist?: string; env?: Record<string, string | undefined> };
export function ingest(opts: IngestOptions): { exit: number; ingested: number; skipped: number; warnings: string[] };
// src/cli.ts — `learn ingest`, `learn scan`
```

## Comportamento esperado

1. **`redact`**, em três camadas e nesta ordem (cada achado vira `[REDACTED:<kind>]`):
   1. regex: `anthropic` `sk-ant-[A-Za-z0-9_-]{20,}`; `github` `gh[pousr]_[A-Za-z0-9]{36,}`; `aws` `\b(?:AKIA|ASIA)[A-Z0-9]{16}\b`; `jwt` `\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`; `private_key` `-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----` (o bloco inteiro vira um marcador); `url_credentials` `([a-z][a-z0-9+.-]*://)[^/\s:@\[\]]+:[^/\s@\[\]]+@` → `$1[REDACTED:url_credentials]@` (colchetes excluídos: um marcador `[REDACTED:…]` nunca é achado de novo);
   2. denylist: o texto restante é quebrado em tokens por `[\s"'=:,;()<>\[\]{}]+`; token com `sha256 ∈ denylist` → `[REDACTED:denylist]`;
   3. entropia: cada sequência máxima de `[A-Za-z0-9+_]` com ≥ `ENTROPY_MIN_LEN` chars e `shannonEntropy ≥ ENTROPY_MIN_BITS` → `[REDACTED:entropy]`, **exceto** hex minúsculo puro de 40 ou 64 chars (sha de git/sha256, I9).
   - `findings` em ordem de posição no texto original; `line` = linha onde o achado começa.
2. **Canário:** `ingest` roda `canaryCheck(PINGA_REDACT_CANARY ? linhas não vazias do arquivo : canary(), { denylist })` **antes** de abrir o `learn.db`. Sobrevivente → stderr `canário de redação falhou: <n> valor(es) sobreviveram` (sem os valores), exit 15, banco nem criado.
3. **Schema** (`openLearnDb` cria se não existe; `PRAGMA user_version = 1`):

   ```sql
   CREATE TABLE IF NOT EXISTS session (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL CHECK (kind IN ('receipt','eval','transcript')),
     harness TEXT NOT NULL,                 -- 'pinga' (recibo, EVAL) | 'claude'
     source_path TEXT NOT NULL,
     source_sha256 TEXT NOT NULL,
     repo TEXT,
     task TEXT,
     started_at TEXT, ended_at TEXT,
     model TEXT, model_family TEXT,
     tokens_in INTEGER, tokens_out INTEGER, tokens_cache INTEGER,
     verification TEXT NOT NULL CHECK (verification IN ('pass','fail','none','not run')),
     verification_evidence TEXT,
     receipt_kind TEXT CHECK (receipt_kind IS NULL OR receipt_kind IN ('verify','judge','prove_red')),
     status TEXT, reason_code TEXT, attempts INTEGER,
     rework_cycles INTEGER, commits INTEGER,
     excerpt TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 300),
     ingested_at TEXT NOT NULL
   );
   ```

   `model_family = model === null ? null : modelFamily(model)` (T08). `ingested_at = PINGA_NOW ?? new Date().toISOString()`. `excerpt` e `verification_evidence` passam por `redactExcerpt`; nada mais de texto livre é gravado.
4. **Recibos (`--ledger`)**: arquivo ausente → stderr, exit 8, **sem** criar o ledger; `openLedger(…).verify()` não ok → exit 8, nada gravado. Por linha do ledger:
   - `id = "receipt:" + receipt.id`; `source_path = <ledger absoluto>#<seq>`; `source_sha256 = row.hash`; `task`, `status`, `reason_code`, `attempts` do recibo; `receipt_kind = receiptKind(r)`; `started_at = ended_at = created_at`;
   - `model = author.model`; tokens = `r.tokens.in/out/cache` (`null` continua `NULL`);
   - `verification`: `pass → 'pass'`, `fail → 'fail'`, `blocked`/`not run → 'not run'`; `verification_evidence = "exit=<evidence[0].exit>"` ou `NULL` sem evidência; `excerpt = redactExcerpt(summary)`; `repo = --repo ?? NULL`.
5. **EVAL (`--evals DIR`)**: cada `DIR/*/EVAL.md`. `parseEval` (T07) falhou → aviso no stderr com o caminho, segue. `id = "eval:" + task`; `source_sha256 = sha256(arquivo)`; `model` = executor sem o ` (<família>)` final; tokens de `in=<n> out=<n> cache=<n|null>` (`not run` → três `NULL`); `verification` pelo status como no item 4; `attempts` = tentativas; `excerpt = redactExcerpt("parecer: … | bom: … | ruim: … | mudar: …")`.
6. **Transcripts Claude (`--sessions DIR`)**: cada `**/*.jsonl` (ordem de caminho). `parseClaudeTranscript`:
   - `session_id` = primeiro `sessionId`; `cwd` = primeiro `cwd`; `started_at`/`ended_at` = menor/maior `timestamp`; `model` = último `message.model` de linha `type: "assistant"` diferente de `<synthetic>`;
   - comando de teste = `tool_use` `Bash` cujo `input.command` casa `TEST_CMD_RE` (`bun test`, `go test`, `mvn … test`/`surefire:test`, `mise exec -- lefthook run`, `pinga verify`, `pinga-stable verify`); resultado = `tool_result` com o mesmo `tool_use_id`: `is_error === true` → `fail`, senão `pass`; sem resultado → `not run`;
   - `verification` = resultado do **último** comando de teste; nenhum → `none`. `verification_evidence` = `` `${resultado} · ${comando cortado em 120} · linha ${n}` `` do último;
   - `rework_cycles` = nº de resultados de teste `fail` seguidos de pelo menos um `tool_use` em `EDIT_TOOLS` antes do próximo comando de teste;
   - `commits` = nº de `tool_use` `Bash` com `git commit` cujo resultado não é erro;
   - `excerpt_source` = conteúdo do primeiro resultado de teste `fail`; senão o comando do primeiro `git commit`; senão o primeiro texto do usuário; senão `null`;
   - `repoFromCwd`: `…/<r>/.worktrees/<w>[/…]` → `<r>@<w>`; senão `basename(cwd)`; `null` → `null`.
   - Linha: `id = "claude:" + (session_id ?? basename sem .jsonl)`, `harness: "claude"`, `kind: "transcript"`, tokens de `tokenFieldsFor(path)` (T06; inválido ou sem uso → `NULL`), `repo = --repo ?? repoFromCwd(cwd)`, `status`/`reason_code`/`attempts`/`receipt_kind` `NULL`.
7. **Idempotência:** mesma `id` e mesmo `source_sha256` → pulada (nem `ingested_at` muda); mesma `id` e `source_sha256` diferente → substituída. stdout: `ingested <n> skipped <m>`; exit 0 (avisos não mudam o exit).
8. **`--db` dentro de repo (I7):** se o diretório do `--db` está numa work tree git e `git check-ignore -q <db>` falha → stderr contém `dentro de repo`, exit 2, nada criado.
9. **`pinga learn scan <arquivo...> [--allow PATH]... [--denylist PATH]`**: por achado, stdout `<arquivo>:<linha>: <kind>` (nunca o valor); arquivo com byte NUL é pulado; `--allow` pula o caminho; arquivo ilegível → stderr, exit 8; algum achado → exit 1; senão 0.
10. **CLI:** `pinga learn ingest [--ledger PATH] [--evals DIR] [--sessions DIR] [--db PATH] [--repo NOME] [--denylist PATH]`. `--db` padrão `defaultLearnDbPath()` = `PINGA_LEARN_DB` › `${XDG_STATE_HOME:-$HOME/.local/state}/pinga/learn.db`. Sem nenhuma fonte, flag desconhecida ou sem valor, subcomando desconhecido → exit 2. A `USAGE` ganha `pinga learn ingest` e `pinga learn scan`.

## Casos — `tests/redact.test.ts`

1. `shannonEntropy`: `""` → 0; `"aaaa"` → 0; `"ab"` → 1; `"abcd"` → 2; as 24 letras de `"Zq8vR2mX7kLp" + "4Wn9Tb3Yc6Hd"` → `log2(24)` (±1e-9).
2. **Fixture:** `redact(readFileSync(fixture))` → `text` igual às 8 linhas da coluna "saída esperada" (com `\n` final); `findings.map(f => [f.kind, f.line])` = `[["anthropic",2],["github",3],["aws",4],["jwt",5],["private_key",6],["url_credentials",9],["entropy",10]]`; o texto não contém `FAKE`, `hunter2` nem `Zq8v`; `redact` da saída não acha nada (idempotente).
3. **Regex isolados** (valores montados no teste): cada formato da fixture sozinho dá exatamente um achado do kind certo; `"sk-ant-" + "x".repeat(5)` (curto) não é redigido; URL sem senha (`https://host.example/x`) fica igual.
4. **Entropia, fronteira:** as 24 chars do caso 1 → `[REDACTED:entropy]`; as 23 primeiras → iguais; 40 e 64 hex minúsculos (sha1/sha256 de `"x"`) → iguais; `verificacao_de_integracao_continua`, `-home-shibuka-Projetos-duh-homelab-pi-harness--worktrees-fix-0047`, `claude-opus-5-5-20261001-preview` e um UUID → iguais.
5. **Denylist:** arquivo com `sha256("hunter2hunter2")` (mais uma linha vazia e um comentário) → `redact("senha=hunter2hunter2 fim", { denylist })` = `senha=[REDACTED:denylist] fim`; sem denylist → igual; arquivo com linha `xyz` → `loadDenylist` lança.
6. **Canário:** `canaryCheck()` → `ok`; `canary().length === 7`; `canaryCheck(["hunter2hunter2"])` → `{ ok: false, survivors: 1 }`; com a denylist do caso 5 → `ok`.
7. **Ordem redigir → cortar:** texto de 400 chars com o token `github` da fixture começando na posição 290 → `redactExcerpt` não contém `ghp_` e tem ≤ 300 chars; `redactExcerpt("")` e `redactExcerpt(null)` → `null`.
8. **`learn scan`:** na fixture → exit 1 e stdout = 7 linhas `testdata/secrets/fake-token.txt:<n>: <kind>` com `n` = 2, 3, 4, 5, 6, 9, 10; stdout sem `FAKE` nem `hunter2`. Com `--allow testdata/secrets/fake-token.txt` → exit 0, stdout vazio. Arquivo limpo → 0. Inexistente → 8. Arquivo com `\0` → 0.
9. **AC-SEC:** `git ls-files` do repo + `learn scan --allow testdata/secrets/fake-token.txt` → exit 0 (nenhum segredo sintético literal no repo, inclusive em `src/redact.ts` e nos testes).

## Casos — `tests/learn.test.ts`

10. **Schema:** `PRAGMA table_info(session)` dá os nomes de `SESSION_COLUMNS` na ordem do item 3; `user_version = 1`; `INSERT` com `verification = 'ok'`, com `verification` nulo, com `excerpt` de 301 chars ou com `kind = 'x'` → erro do SQLite.
11. **`defaultLearnDbPath`** (env falso, sem tocar no HOME real): `PINGA_LEARN_DB` vence; senão `XDG_STATE_HOME/pinga/learn.db`; senão `<HOME>/.local/state/pinga/learn.db`.
12. **Recibos:** ledger temporário (`openLedger`) com 4 recibos válidos: (a) `pass`, `author.model: "glm-5.3-flash-free"`, tokens `in 10 out 2 cache null source host-structured`; (b) `fail`/`command_failed` com `NOT_RUN_TOKENS` e `summary` contendo o token `github` montado; (c) `blocked`/`breaker_same_failure`, `author.model: null`; (d) `flow: "judge"`. Depois do `ingest`:
    - 4 linhas `kind = 'receipt'`; (a) `tokens_in = 10`, `tokens_out = 2`, `tokens_cache IS NULL`; (b) os três tokens `IS NULL`; `SELECT count(*) FROM session WHERE tokens_in = 0 OR tokens_out = 0 OR tokens_cache = 0` = 0;
    - `verification` = `pass`, `fail`, `not run`; (a) `model_family = 'glm'`; (c) `model IS NULL` e `model_family IS NULL`; (d) `receipt_kind = 'judge'`;
    - `excerpt` de (b) contém `[REDACTED:github]` e não contém `ghp_`.
13. **Idempotência:** segundo `ingest` → stdout `ingested 0 skipped 4` e `SELECT * FROM session ORDER BY id` idêntico; um 5º recibo no ledger → `ingested 1 skipped 4`.
14. **Ledger inválido:** `--ledger <inexistente>` → exit 8 e o arquivo continua inexistente; ledger com uma linha adulterada (trigger removido no teste, `UPDATE` do `body`) → exit 8 e o `learn.db` não ganha linhas.
15. **EVAL:** `T90/EVAL.md` (executor `opencode/glm-5.3-flash-free (glm)`, tokens `in=5471 out=11 cache=null usd=null`, `parecer` com o token `aws` montado), `T91/EVAL.md` (tokens `not run`), `T92/EVAL.md` inválido. → `eval:T90` com `5471`, `11`, `NULL` e `model_family = 'glm'`; `eval:T91` com três `NULL`; stderr cita `T92`; exit 0; nenhum `excerpt` contém `AKIA`. Reingestão igual → pulada; mudar a linha `bom:` de `T90` → `ingested 1`, mesma contagem de linhas.
16. **Transcript Claude:** `sessions/-tmp-proj/s1.jsonl` com `sessionId: "s1"`, `cwd: "/tmp/x/proj"`, `timestamp` crescente, e na ordem: texto do usuário; assistant (`model: "claude-opus-5-5"`, `usage` de T06) com `Bash bun test` → resultado `is_error: true` com o token `anthropic` montado no conteúdo; `Edit src/a.ts`; `bun test` → erro; `Write src/a.ts`; `bun test` → erro; `Edit`; `bun test` → ok; `Bash git commit -m x` → ok. →
    - `claude:s1`: `rework_cycles = 3`, `commits = 1`, `verification = 'pass'`, `model_family = 'claude'`, `repo = 'proj'`, tokens = `tokenFieldsFor(path).tokens` (`in`/`out`/`cache`);
    - `excerpt` vem do primeiro resultado com erro, contém `[REDACTED:anthropic]` e não contém `sk-ant-`.
    - `s2.jsonl`: só `git commit` → `verification = 'none'`, `commits = 1`, `excerpt` = o comando.
    - `s3.jsonl`: `bun test` sem `tool_result` → `verification = 'not run'`.
    - `s4.jsonl`: sem linha de uso → os três tokens `IS NULL`.
    - `repoFromCwd("/r/pi-harness/.worktrees/fix-0047/src")` → `pi-harness@fix-0047`.
17. **Canário falhou:** `PINGA_REDACT_CANARY=<arquivo com "hunter2hunter2">` → exit 15, stderr contém `canário` e não contém `hunter2`, o `learn.db` não existe.
18. **Dentro de repo:** `--db <repo git temporário>/l.db` → exit 2, stderr `dentro de repo`, arquivo inexistente; com `.gitignore` `*.db` nesse repo → exit 0.
19. **Nada vaza:** depois dos casos 12–16, `redact` de toda coluna `TEXT` de toda linha não acha nada, e `SELECT count(*) FROM session WHERE excerpt LIKE '%FAKE%' OR verification_evidence LIKE '%FAKE%'` = 0.
20. **CLI:** `learn ingest` sem fonte → 2; `--db` sem valor → 2; `learn xpto` → 2; `learn scan` sem arquivo → 2; a `USAGE` contém `pinga learn ingest` e `pinga learn scan`.
