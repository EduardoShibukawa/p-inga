# RED T16 — Ingestão Multi-Harness (`tests/multi-ingest.test.ts`)

## 1. Escopo e Contrato

Estende `src/transcript.ts`, `src/learn.ts` e `src/cli.ts` para suportar ingestão segura de sessões do `pi` (JSONL), `opencode` (SQLite `opencode.db`), `hermes` (SQLite `state.db`) e Markdown de fricção (`FRICTION.md`, `OVERNIGHT-REPORT-*.md`) em `learn.db`.

### 1.1 Invariantes de Segurança
1. **Blocklist estrita de credenciais**: qualquer caminho cujo nome base seja `auth.json`, `.env`, `.credentials.json` ou cujo diretório contenha `/secrets/` ou `/.secrets/` é rejeitado por `isForbiddenPath(path) === true` e NUNCA aberto para leitura.
2. **Redação 3 camadas antes de gravação**: todo texto (prompt, saída de ferramenta, excerpt) passa por `redactText`. O canário (`testCanary`) roda antes de qualquer inserção SQL.
3. **Preservação de nulos (Lei 1 / I4 / I19)**: tokens ausentes persistem como `NULL`, nunca 0.

## 2. API Esperada

```ts
// src/transcript.ts
export const FORBIDDEN_PATH_PATTERNS: RegExp[];
export function isForbiddenPath(filePath: string): boolean;

export function parsePiSession(filePath: string): {
  id: string;
  repo: string | null;
  started_at: string | null;
  ended_at: string | null;
  model: string | null;
  model_family: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cache: number | null;
  verification: "pass" | "fail" | "none" | "not run";
  verification_evidence: string | null;
  raw_events_count: number;
};

export function parseOpencodeDb(dbPath: string): Array<{
  id: string;
  repo: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cache: number | null;
  verification: "pass" | "fail" | "none" | "not run";
}>;

export function parseHermesDb(dbPath: string): Array<{
  id: string;
  repo: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cache: number | null;
  verification: "pass" | "fail" | "none" | "not run";
}>;

export function parseFrictionMarkdown(filePath: string): Array<{
  id: string;
  pattern: string;
  evidence: string;
  suggested_action: string;
}>;

// src/learn.ts
export type MultiIngestOptions = {
  dbPath?: string;
  piDir?: string;
  opencodeDb?: string;
  hermesDb?: string;
  frictionFile?: string;
  dryRun?: boolean;
};

export function ingestMultiHarness(opts: MultiIngestOptions): Promise<{
  piSessionsIngested: number;
  opencodeSessionsIngested: number;
  hermesSessionsIngested: number;
  frictionEntriesIngested: number;
  forbiddenPathsBlocked: number;
}>;
```

## 3. Casos de Teste (`tests/multi-ingest.test.ts`)

1. `isForbiddenPath` retorna `true` para `~/.pi/agent/auth.json`, `/home/u/.hermes/.env`, `/repo/secrets/token.txt`, e `false` para caminhos normais.
2. Tentativa de ingestão passando caminho proibido via CLI ou opções emite aviso seguro e bloqueia a abertura sem erro fatal (`forbiddenPathsBlocked === 1`).
3. `parsePiSession` extrai corretamente `toolCalls`, `stopReason`, modelo (`qwen3.8-flash`), família (`qwen`), tokens e status de verificação de fixture JSONL sintética.
4. `parsePiSession` com tokens ausentes gera `tokens_in === null`, nunca 0.
5. `parseOpencodeDb` lê tabela `session_v2` / `session` em SQLite temporário read-only e retorna metadados de sessão.
6. `parseHermesDb` lê tabela `sessions` + `messages` em SQLite temporário read-only e retorna metadados sanitizados.
7. `parseFrictionMarkdown` extrai blocos de findings de arquivo de fricção sintético (`FRICTION.md`).
8. `ingestMultiHarness` grava todas as fontes na tabela `session` do `learn.db` com idempotência por `source_sha256`.
9. `ingestMultiHarness` aplica `redactText` e aciona canário antes de inserir registros.
10. CLI `pinga learn ingest --pi <dir> --opencode <db> --hermes <db> --friction <file>` integra perfeitamente e reporta contagens JSON.
