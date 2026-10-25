import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { modelFamily } from "./family";
import { clip } from "./redact";

// Comandos que contam como verificação num transcript do Claude Code.
// Sem a flag `g`: `.test()` tem que ser stateless.
export const TEST_CMD_RE: RegExp =
  /\b(?:bun\s+test\b|go\s+test\b|mvn\s[^;|&]*\btest\b|surefire:test\b|mise\s+exec\s+--\s+lefthook\s+run\b|pinga(?:-stable)?\s+verify\b)/;

export const EDIT_TOOLS: readonly string[] = [
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
];

export type TranscriptSummary = {
  session_id: string | null;
  cwd: string | null;
  started_at: string | null;
  ended_at: string | null;
  model: string | null;
  verification: "pass" | "fail" | "none" | "not run";
  verification_evidence: string | null;
  rework_cycles: number;
  commits: number;
  excerpt_source: string | null;
};

type ToolUse = {
  name: string;
  command: string | null;
  line: number;
  isError: boolean | null; // null = sem tool_result
  result: string | null;
};

type Kind = "test" | "commit" | "edit" | "other";

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (
        item !== null &&
        typeof item === "object" &&
        (item as Record<string, unknown>).type === "text" &&
        typeof (item as Record<string, unknown>).text === "string"
      ) {
        parts.push((item as Record<string, unknown>).text as string);
      }
    }
    return parts.join("\n");
  }
  return "";
}

function userText(content: unknown): string | null {
  const joined = contentText(content);
  return joined === "" ? null : joined;
}

function classify(tu: ToolUse): Kind {
  if (tu.name === "Bash" && tu.command !== null) {
    if (TEST_CMD_RE.test(tu.command)) return "test";
    if (tu.command.includes("git commit")) return "commit";
  }
  if (EDIT_TOOLS.includes(tu.name)) return "edit";
  return "other";
}

/**
 * Parser puro de um transcript JSONL do Claude Code (item 6 do RED T14).
 * Linhas malformadas são puladas; nada aqui toca no sistema de arquivos.
 */
export function parseClaudeTranscript(text: string): TranscriptSummary {
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let model: string | null = null;
  let firstUserText: string | null = null;
  const uses: ToolUse[] = [];
  const byId = new Map<string, ToolUse>();

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw === "") continue;
    let obj: any;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (obj === null || typeof obj !== "object") continue;

    if (sessionId === null && typeof obj.sessionId === "string" && obj.sessionId !== "") {
      sessionId = obj.sessionId;
    }
    if (cwd === null && typeof obj.cwd === "string" && obj.cwd !== "") {
      cwd = obj.cwd;
    }
    if (typeof obj.timestamp === "string" && obj.timestamp !== "") {
      if (startedAt === null || obj.timestamp < startedAt) startedAt = obj.timestamp;
      if (endedAt === null || obj.timestamp > endedAt) endedAt = obj.timestamp;
    }

    const message: unknown =
      typeof obj.message === "object" && obj.message !== null ? obj.message : null;

    if (obj.type === "assistant" && message !== null) {
      const m = message as Record<string, unknown>;
      if (
        typeof m.model === "string" &&
        m.model !== "" &&
        m.model !== "<synthetic>"
      ) {
        model = m.model;
      }
    }

    if (message !== null && Array.isArray((message as Record<string, unknown>).content)) {
      const content = (message as Record<string, unknown>).content as unknown[];
      for (const item of content) {
        if (item === null || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        if (it.type === "tool_use" && typeof it.id === "string" && it.id !== "") {
          const input =
            typeof it.input === "object" && it.input !== null
              ? (it.input as Record<string, unknown>)
              : {};
          const tu: ToolUse = {
            name: typeof it.name === "string" ? it.name : "",
            command: typeof input.command === "string" ? input.command : null,
            line: i + 1,
            isError: null,
            result: null,
          };
          uses.push(tu);
          byId.set(it.id, tu);
        } else if (it.type === "tool_result" && typeof it.tool_use_id === "string") {
          const tu = byId.get(it.tool_use_id);
          if (tu === undefined || tu.isError !== null) continue;
          tu.isError = it.is_error === true;
          tu.result = contentText(it.content);
        }
      }
    }

    if (firstUserText === null && obj.type === "user" && message !== null) {
      const t = userText((message as Record<string, unknown>).content);
      if (t !== null) firstUserText = t;
    }
  }

  const kinds = uses.map(classify);

  // rework_cycles: resultado de teste fail seguido de pelo menos um tool_use
  // de edição antes do próximo comando de teste.
  let reworkCycles = 0;
  let pendingFail = false;
  let counted = false;
  for (let i = 0; i < uses.length; i++) {
    const kind = kinds[i]!;
    if (kind === "test") {
      pendingFail = uses[i]!.isError === true;
      counted = false;
    } else if (kind === "edit" && pendingFail && !counted) {
      reworkCycles++;
      counted = true;
    }
  }

  // commits: Bash "git commit" cujo resultado não é erro.
  let commits = 0;
  for (let i = 0; i < uses.length; i++) {
    if (kinds[i] === "commit" && uses[i]!.isError === false) commits++;
  }

  // verification: resultado do ÚLTIMO comando de teste; nenhum → "none".
  let verification: TranscriptSummary["verification"] = "none";
  let evidence: string | null = null;
  let lastTest = -1;
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === "test") lastTest = i;
  }
  if (lastTest !== -1) {
    const tu = uses[lastTest]!;
    const outcome =
      tu.isError === null ? "not run" : tu.isError ? "fail" : "pass";
    verification = outcome;
    evidence = `${outcome} · ${clip(tu.command ?? "", 120)} · linha ${tu.line}`;
  }

  // excerpt_source: 1º resultado de teste fail; senão comando do 1º
  // git commit; senão 1º texto do usuário; senão null.
  let excerptSource: string | null = null;
  for (let i = 0; i < uses.length; i++) {
    if (kinds[i] === "test" && uses[i]!.isError === true) {
      excerptSource = uses[i]!.result;
      break;
    }
  }
  if (excerptSource === null) {
    for (let i = 0; i < uses.length; i++) {
      if (kinds[i] === "commit") {
        excerptSource = uses[i]!.command;
        break;
      }
    }
  }
  if (excerptSource === null) excerptSource = firstUserText;

  return {
    session_id: sessionId,
    cwd,
    started_at: startedAt,
    ended_at: endedAt,
    model,
    verification,
    verification_evidence: evidence,
    rework_cycles: reworkCycles,
    commits,
    excerpt_source: excerptSource,
  };
}

/**
 * `.../<r>/.worktrees/<w>[/...]` → `<r>@<w>`; senão basename(cwd);
 * null → null.
 */
export function repoFromCwd(cwd: string | null): string | null {
  if (cwd === null) return null;
  const m = cwd.match(/\/([^/]+)\/\.worktrees\/([^/]+)(?:\/.*)?$/);
  if (m !== null) return `${m[1]}@${m[2]}`;
  return basename(cwd);
}

export type VerificationStatus = "pass" | "fail" | "none" | "not run";

export type DbSessionSummary = {
  id: string;
  repo: string | null;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cache: number | null;
  verification: VerificationStatus;
};

export type FrictionEntry = {
  id: string;
  pattern: string;
  evidence: string;
  suggested_action: string;
};

export type PiSessionSummary = {
  id: string;
  repo: string | null;
  started_at: string | null;
  ended_at: string | null;
  model: string | null;
  model_family: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  tokens_cache: number | null;
  verification: VerificationStatus;
  verification_evidence: string | null;
  raw_events_count: number;
};

// T16 — blocklist estrita de credenciais (RED §1.1.1). Basenames de arquivos
// de credencial e segmentos de diretório de segredos. `.test()` é stateless:
// nenhuma das regex usa a flag `g`.
export const FORBIDDEN_PATH_PATTERNS: RegExp[] = [
  /(^|\/)auth\.json$/,
  /(^|\/)\.env$/,
  /(^|\/)\.credentials\.json$/,
  /(^|\/)credentials\.json$/,
  /\/\.?secrets\//,
];

export function isForbiddenPath(filePath: string): boolean {
  for (const re of FORBIDDEN_PATH_PATTERNS) {
    if (re.test(filePath)) return true;
  }
  return false;
}

type PiToolCall = {
  command: string | null;
  result: string | null;
  isError: boolean | null; // null = sem tool_result
};

/**
 * Parser puro de um transcript JSONL do pi (RED T16). Linhas malformadas são
 * puladas; tokens ausentes ficam NULL (nunca 0 — Lei 1/I4/I19).
 */
export function parsePiSession(filePath: string): PiSessionSummary {
  const text = readFileSync(filePath, "utf8");
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let model: string | null = null;
  let rawEventsCount = 0;
  let sawUsage = false;
  let hasIn = false;
  let hasOut = false;
  let hasCache = false;
  let inSum = 0;
  let outSum = 0;
  let cacheSum = 0;
  const calls = new Map<string, PiToolCall>();

  const addCall = (id: string, command: string | null): void => {
    if (id !== "" && !calls.has(id)) calls.set(id, { command, result: null, isError: null });
  };

  for (const raw of text.split(/\r?\n/)) {
    const dec = raw.trim();
    if (dec === "") continue;
    let obj: any;
    try {
      obj = JSON.parse(dec);
    } catch {
      continue;
    }
    if (obj === null || typeof obj !== "object") continue;
    rawEventsCount++;

    if (typeof obj.timestamp === "string" && obj.timestamp !== "") {
      if (startedAt === null || obj.timestamp < startedAt) startedAt = obj.timestamp;
      if (endedAt === null || obj.timestamp > endedAt) endedAt = obj.timestamp;
    }
    if (
      sessionId === null &&
      typeof obj.id === "string" &&
      obj.id !== ""
    ) {
      sessionId = obj.id;
    }
    if (cwd === null && typeof obj.cwd === "string" && obj.cwd !== "") {
      cwd = obj.cwd;
    }
    if (
      model === null &&
      typeof obj.model === "string" &&
      obj.model !== "" &&
      obj.model !== "<synthetic>"
    ) {
      model = obj.model;
    }

    if (obj.type === "assistant" && obj.usage !== null && typeof obj.usage === "object") {
      const u = obj.usage as Record<string, unknown>;
      sawUsage = true;
      if (typeof u.input_tokens === "number") {
        hasIn = true;
        inSum += u.input_tokens;
      }
      if (typeof u.output_tokens === "number") {
        hasOut = true;
        outSum += u.output_tokens;
      }
      if (typeof u.cache_read_input_tokens === "number") {
        hasCache = true;
        cacheSum += u.cache_read_input_tokens;
      }
    }

    if (Array.isArray(obj.toolCalls)) {
      for (const tc of obj.toolCalls) {
        if (tc === null || typeof tc !== "object") continue;
        const t = tc as Record<string, unknown>;
        const id = typeof t.id === "string" ? t.id : "";
        const input =
          typeof t.input === "object" && t.input !== null
            ? (t.input as Record<string, unknown>)
            : {};
        addCall(id, typeof input.command === "string" ? input.command : null);
      }
    }

    if (obj.type === "tool_result") {
      const id = typeof obj.toolCallId === "string" ? obj.toolCallId : "";
      const call = calls.get(id);
      if (call !== undefined && call.isError === null) {
        call.isError = obj.isError === true;
        call.result = contentText(obj.content);
      }
    }
  }
  void sawUsage;

  // verification: resultado da ÚLTIMA chamada cujo comando é de teste
  // (TEST_CMD_RE). Sem chamada de teste → "none".
  let verification: PiSessionSummary["verification"] = "none";
  let evidence: string | null = null;
  for (const call of calls.values()) {
    if (call.command === null || !TEST_CMD_RE.test(call.command)) continue;
    if (call.isError === null) {
      verification = "not run";
    } else {
      verification = call.isError ? "fail" : "pass";
    }
    evidence = `${verification} · ${clip(call.command, 120)}`;
  }

  return {
    id: sessionId ?? basename(filePath).replace(/\.jsonl$/, ""),
    repo: repoFromCwd(cwd),
    started_at: startedAt,
    ended_at: endedAt,
    model,
    model_family: model === null ? null : modelFamily(model),
    tokens_in: hasIn ? inSum : null,
    tokens_out: hasOut ? outSum : null,
    tokens_cache: hasCache ? cacheSum : null,
    verification,
    verification_evidence: evidence,
    raw_events_count: rawEventsCount,
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function tablesOf(db: Database): Set<string> {
  return new Set(
    (
      db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name),
  );
}

function columnsOf(db: Database, table: string): Set<string> {
  return new Set(
    (
      db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    ).map((c) => c.name),
  );
}

function verificationFromOutcome(value: unknown): VerificationStatus {
  return value === "pass"
    ? "pass"
    : value === "fail"
      ? "fail"
      : "none";
}

/**
 * T16 — lê `session_v2` (fallback `session`) de um opencode.db SQLite aberto
 * em modo read-only. Colunas ausentes viram NULL/none.
 */
export function parseOpencodeDb(dbPath: string): DbSessionSummary[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = tablesOf(db);
    const table = tables.has("session_v2")
      ? "session_v2"
      : tables.has("session")
        ? "session"
        : null;
    if (table === null) return [];
    const cols = columnsOf(db, table);
    const col = (name: string): string => (cols.has(name) ? name : "NULL");
    const raw = db
      .query(
        `SELECT id, ${col("directory")} AS directory, ${col("model")} AS model,
         ${col("tokens_in")} AS tokens_in, ${col("tokens_out")} AS tokens_out,
         ${col("tokens_cache")} AS tokens_cache, ${col("idle_outcome")} AS idle_outcome
         FROM ${table}`,
      )
      .all() as Array<Record<string, unknown>>;

    const out: DbSessionSummary[] = [];
    for (const r of raw) {
      const id = strOrNull(r.id);
      if (id === null) continue;
      out.push({
        id,
        repo: repoFromCwd(strOrNull(r.directory)),
        model: strOrNull(r.model),
        tokens_in: numOrNull(r.tokens_in),
        tokens_out: numOrNull(r.tokens_out),
        tokens_cache: numOrNull(r.tokens_cache),
        verification: verificationFromOutcome(r.idle_outcome),
      });
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * T16 — lê `sessions` (+ `messages` para verificação) de um state.db do
 * hermes aberto em modo read-only. Tokens ausentes ficam NULL (nunca 0).
 */
export function parseHermesDb(dbPath: string): DbSessionSummary[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = tablesOf(db);
    if (!tables.has("sessions")) return [];
    const cols = columnsOf(db, "sessions");
    const col = (name: string): string => (cols.has(name) ? name : "NULL");
    const raw = db
      .query(
        `SELECT id, ${col("cwd")} AS cwd, ${col("model")} AS model,
         ${col("input_tokens")} AS input_tokens, ${col("output_tokens")} AS output_tokens,
         ${col("cache_read_tokens")} AS cache_read_tokens FROM sessions`,
      )
      .all() as Array<Record<string, unknown>>;

    // messages: um comando de teste no conteúdo vira verificação pass/fail.
    const verified = new Map<string, VerificationStatus>();
    if (tables.has("messages")) {
      try {
        const msgs = db
          .query("SELECT session_id, content FROM messages")
          .all() as Array<Record<string, unknown>>;
        for (const m of msgs) {
          const sid = strOrNull(m.session_id);
          const content = typeof m.content === "string" ? m.content : "";
          if (sid === null || !TEST_CMD_RE.test(content)) continue;
          verified.set(sid, /fail|error/i.test(content) ? "fail" : "pass");
        }
      } catch {
        // schema de messages diferente: verificação fica "none"
      }
    }

    const out: DbSessionSummary[] = [];
    for (const r of raw) {
      const id = strOrNull(r.id);
      if (id === null) continue;
      out.push({
        id,
        repo: repoFromCwd(strOrNull(r.cwd)),
        model: strOrNull(r.model),
        tokens_in: numOrNull(r.input_tokens),
        tokens_out: numOrNull(r.output_tokens),
        tokens_cache: numOrNull(r.cache_read_tokens),
        verification: verified.get(id) ?? "none",
      });
    }
    return out;
  } finally {
    db.close();
  }
}

const FRICTION_HEADING_RE = /^#+\s+([A-Za-z][A-Za-z0-9-]*)/;
const FRICTION_BULLET_RE = /^\s*[-*]\s*(Pattern|Evidence|Action)\s*:\s*(.*?)\s*$/i;

/**
 * T16 — extrai achados estruturados de um FRICTION.md: seções `## <id>: ...`
 * com bullets `- Pattern:`, `- Evidence:`, `- Action:`.
 */
export function parseFrictionMarkdown(filePath: string): FrictionEntry[] {
  const text = readFileSync(filePath, "utf8");
  const entries: FrictionEntry[] = [];
  let id: string | null = null;
  let pattern = "";
  let evidence = "";
  let action = "";
  const flush = (): void => {
    if (id === null) return;
    if (pattern !== "" || evidence !== "" || action !== "") {
      entries.push({ id, pattern, evidence, suggested_action: action });
    }
    id = null;
    pattern = "";
    evidence = "";
    action = "";
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const h = line.match(FRICTION_HEADING_RE);
    if (h !== null) {
      flush();
      id = h[1]!;
      continue;
    }
    if (id === null) continue;
    const b = line.match(FRICTION_BULLET_RE);
    if (b === null) continue;
    const key = b[1]!.toLowerCase();
    const value = b[2]!;
    if (key === "pattern") pattern = value;
    else if (key === "evidence") evidence = value;
    else action = value;
  }
  flush();
  return entries;
}
