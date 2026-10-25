# EXEC T14 — `learn.db` e Ingestão com Redação de Segredos (D19 / I19)

## Relatório pré-task (`pinga-stable doctor --endpoint http://127.0.0.1:8001`)
```text
unverified manifest/integrity: nada instalado (manifest ausente)
ok pi/global_status: skills instaladas
degraded claude/plugin_list: plugin pi-harness ausente em plugin list
broken claude/plugin_validate: plugin validate exit 1
degraded opencode/plugin_list: plugin pi-harness ausente
degraded hermes/plugins_list: linha do plugin pi-harness ausente
broken hermes/doctor: hermes doctor exit 1
degraded tuios/integration_status: integração não instalada em alguma parte
ok llm/models: served qwen2.5-3b-instruct
```

Você é o **EXECUTOR** (`opencode/glm-5.3-flash-free`) da tarefa **T14** do projeto P-Ingá v0.1 em `/home/shibuka/Projetos/duh-homelab/p-inga`.

## Contrato imutável
- **Plano:** `tasks/T14/PLAN.md`
- **Especificação detalhada dos testes e API:** `tasks/T14/RED.md` e `specs/0003-p-inga-v0.1-rodada-4.md`
- **`done_when`:** `bun test tests/redact.test.ts tests/learn.test.ts` (e a suíte inteira `bun test` também deve passar no pre-commit).
- **`touch` permitido (ESTRITO — não crie nenhum outro arquivo em `src/`):** `["src/redact.ts", "src/learn.ts", "src/transcript.ts", "src/cli.ts"]`
- **`tests_frozen` (PROIBIDO EDITAR):** `["tests/learn.test.ts", "tests/redact.test.ts", "testdata/secrets/fake-token.txt", "tests/adapters.test.ts", "tests/doctor.test.ts", "tests/helpers/stubs.ts", "tests/install.test.ts", "tests/helpers/home.ts", "tests/prove.test.ts", "tests/examples.test.ts", "tests/mode.test.ts", "tests/judge.test.ts", "tests/eval.test.ts", "tests/tokens.test.ts", "tests/breaker.test.ts", "tests/guards.test.ts", "tests/verify.test.ts", "tests/ledger.test.ts", "tests/receipt.test.ts", "tests/repo.test.ts"]`
- **Higiene obrigatória do código-fonte (Caso 9 / AC-SEC):** NENHUM segredo sintético pode aparecer literal em `src/redact.ts`! Em `canary()`, monte todos os 7 valores por concatenação em runtime (ex.: `"sk-ant-" + "api03-" + "FAKE".repeat(10) + "-AAAA"`, `"Zq8vR2mX" + "7kLp4Wn9" + "Tb3Yc6Hd" + "1Jf5Gs0Ae"`, etc.) para que `pinga learn scan --allow testdata/secrets/fake-token.txt` em `git ls-files` passe com exit 0!

## O que implementar

### 1. `src/redact.ts`
Exporte exatamente a API de `tasks/T14/RED.md`:
- `export const REDACT_KINDS = ["anthropic", "github", "aws", "jwt", "private_key", "url_credentials", "denylist", "entropy"] as const;`
- `export type RedactKind = (typeof REDACT_KINDS)[number];`
- `export const ENTROPY_MIN_BITS = 4.0;`
- `export const ENTROPY_MIN_LEN = 24;`
- `export const EXCERPT_MAX = 300;`
- `export function shannonEntropy(s: string): number`:
  - `if (s.length === 0) return 0;`
  - Conta frequência de cada caractere; `H = - sum((count / n) * Math.log2(count / n))`.
- `export function redact(text: string, opts?: { denylist?: ReadonlySet<string> }): { text: string; findings: Array<{ kind: RedactKind; line: number }> }`:
  - Aplica as 3 camadas descritas no item 1 de `tasks/T14/RED.md` e retorna o texto redigido + `findings` ordenados por posição no texto original (`line` 1-based no texto de entrada original!):
    1. Regex:
       - `anthropic`: `/sk-ant-[A-Za-z0-9_-]{20,}/g` -> `[REDACTED:anthropic]`
       - `github`: `/gh[pousr]_[A-Za-z0-9]{36,}/g` -> `[REDACTED:github]`
       - `aws`: `/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g` -> `[REDACTED:aws]`
       - `jwt`: `/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g` -> `[REDACTED:jwt]`
       - `private_key`: `/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g` -> `[REDACTED:private_key]`
       - `url_credentials`: `/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@\[\]]+:[^/\s@\[\]]+)@/g` -> `$1[REDACTED:url_credentials]@`
    2. Denylist: se `opts?.denylist && opts.denylist.size > 0`, quebra/examina tokens delimitados por `[\s"'=:,;()<>\[\]{}]+`; se `sha256hex(token)` estiver em `opts.denylist` (e o token não for parte de `[REDACTED:...]`), substitui por `[REDACTED:denylist]`.
    3. Entropia: para cada sequência máxima de `[A-Za-z0-9+_]` (que não esteja dentro de `[REDACTED:...]`):
       - Se `token.length >= ENTROPY_MIN_LEN`:
         - Se for hex minúsculo puro de 40 ou 64 chars (`/^[0-9a-f]{40}$/` ou `/^[0-9a-f]{64}$/`), ignora!
         - Senão se `shannonEntropy(token) >= ENTROPY_MIN_BITS`, substitui por `[REDACTED:entropy]`.
  - Dica de implementação limpa para preservar o número de linha `line` (1-based no texto de entrada original) e ordenar por posição original:
    - Quando `private_key` (multi-linha) é substituído, o `line` é a linha onde `-----BEGIN` começou no texto original. Atenção: como `private_key` colapsa 3 linhas em 1 no texto de saída, calcule os offsets/linhas das ocorrências no texto original (ou preserve quebras de linha internamente durante a detecção de linha e colapse na saída final) para que na fixture de 10 linhas os números de linha sejam exatamente `2, 3, 4, 5, 6, 9, 10`!
- `export function loadDenylist(path: string): Set<string>`:
  - Lê `path`, ignora linhas em branco e linhas começando com `#`; cada linha restante (após `trim()`) deve casar `/^[0-9a-f]{64}$/i` (normalizada para lowercase), senão lança `Error`.
- `export function canary(): string[]`:
  - Retorna os 7 segredos sintéticos montados em runtime por concatenação (nunca literais!).
- `export function canaryCheck(values?: readonly string[], opts?: { denylist?: ReadonlySet<string> }): { ok: true } | { ok: false; survivors: number }`:
  - Para cada valor `v` em `values ?? canary()`: roda `const r = redact(v, opts)`; se `r.findings.length === 0 || r.text.includes(v)` -> conta como sobrevivente (`survivors++`).
  - Se `survivors === 0` -> `{ ok: true }`, senão `{ ok: false, survivors }`.
- `export function clip(text: string, max: number = EXCERPT_MAX): string` -> `text.length > max ? text.slice(0, max) : text`
- `export function redactExcerpt(text: string | null, opts?: { denylist?: ReadonlySet<string> }): string | null`:
  - Se `text === null || text === ""` -> `null`.
  - Redige primeiro (`const red = redact(text, opts).text`), depois corta (`clip(red, EXCERPT_MAX)`). Se vazio -> `null`.

### 2. `src/transcript.ts`
Exporte exatamente:
- `export const TEST_CMD_RE: RegExp` (casando `bun test`, `go test`, `mvn ... test`, `surefire:test`, `mise exec -- lefthook run`, `pinga verify`, `pinga-stable verify`)
- `export const EDIT_TOOLS: readonly string[] = ["Edit", "MultiEdit", "Write", "NotebookEdit"];`
- `export type TranscriptSummary = ...`
- `export function parseClaudeTranscript(text: string): TranscriptSummary` (seguindo fielmente o item 6 de `tasks/T14/RED.md`)
- `export function repoFromCwd(cwd: string | null): string | null` (seguindo o item 6 de `tasks/T14/RED.md`: `.../<r>/.worktrees/<w>[/...]` -> `<r>@<w>`, senão `basename(cwd)`, `null` -> `null`).

### 3. `src/learn.ts`
Exporte exatamente:
- `export const LEARN_SCHEMA_VERSION = 1;`
- `export const LEARN_EXIT = { ok: 0, usage: 2, infra: 8, redaction_canary: 15 } as const;`
- `export const SESSION_COLUMNS = ["id", "kind", "harness", "source_path", "source_sha256", "repo", "task", "started_at", "ended_at", "model", "model_family", "tokens_in", "tokens_out", "tokens_cache", "verification", "verification_evidence", "receipt_kind", "status", "reason_code", "attempts", "rework_cycles", "commits", "excerpt", "ingested_at"] as const;`
- `export function defaultLearnDbPath(env?: Record<string, string | undefined>): string`
- `export function openLearnDb(path: string): Database`
- `export function ingest(opts: IngestOptions): { exit: number; ingested: number; skipped: number; warnings: string[] }`
  - Implemente rigorosamente os itens 2, 3, 4, 5, 6, 7 e 8 de `tasks/T14/RED.md`!

### 4. `src/cli.ts`
- Adicione o comando `learn` com os subcomandos `ingest` e `scan` conforme os itens 9 e 10 de `tasks/T14/RED.md`.
- Atualize `USAGE` com `pinga learn ingest` e `pinga learn scan`.

## Regras de Git e Finalização
1. Rode `bun test tests/redact.test.ts tests/learn.test.ts` e `bun test` até que **todos** os testes passem (incluindo o caso 9 AC-SEC!).
2. Verifique `git status` e `git diff` para garantir que **nenhum** arquivo fora de `touch` (`src/redact.ts`, `src/learn.ts`, `src/transcript.ts`, `src/cli.ts`) foi modificado.
3. Faça o commit GREEN com caminhos explícitos:
   ```bash
   git add src/redact.ts src/learn.ts src/transcript.ts src/cli.ts
   git commit -m "feat(T14): learn.db e ingestão com redação de segredos (I19)" -m "Co-Authored-By: GLM 5.3 Flash <noreply@zhipuai.com>"
   ```
4. Pare imediatamente após o commit GREEN.
