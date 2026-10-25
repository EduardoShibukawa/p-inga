import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CORRECTION_MARKERS_PT_EN } from "./detect";
import { parseEval } from "./eval";
import { modelFamily } from "./family";
import { openLedger } from "./ledger";
import { receiptKind, type Receipt } from "./receipt";
import { canaryCheck, canary, loadDenylist, redactExcerpt } from "./redact";
import {
  isForbiddenPath,
  parseClaudeTranscript,
  parseFrictionMarkdown,
  parseHermesDb,
  parseOpencodeDb,
  parsePiSession,
  repoFromCwd,
} from "./transcript";
import { tokenFieldsFor } from "./tokens";

export const LEARN_SCHEMA_VERSION = 1;

export const LEARN_EXIT = {
  ok: 0,
  usage: 2,
  infra: 8,
  redaction_canary: 15,
} as const;

export const SESSION_COLUMNS = [
  "id",
  "kind",
  "harness",
  "source_path",
  "source_sha256",
  "repo",
  "task",
  "started_at",
  "ended_at",
  "model",
  "model_family",
  "tokens_in",
  "tokens_out",
  "tokens_cache",
  "verification",
  "verification_evidence",
  "receipt_kind",
  "status",
  "reason_code",
  "attempts",
  "rework_cycles",
  "commits",
  "excerpt",
  "ingested_at",
] as const;

const CREATE_SESSION = `CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('receipt','eval','transcript')),
  harness TEXT NOT NULL,
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
)`;

const CREATE_USER_TURNS = `CREATE TABLE IF NOT EXISTS user_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  text TEXT NOT NULL,
  is_human INTEGER NOT NULL,
  has_correction_marker INTEGER NOT NULL,
  preceding_tool_failed INTEGER NOT NULL
)`;

export function defaultLearnDbPath(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.PINGA_LEARN_DB !== undefined && env.PINGA_LEARN_DB !== "") {
    return env.PINGA_LEARN_DB;
  }
  const stateHome = env.XDG_STATE_HOME ?? `${env.HOME}/.local/state`;
  return `${stateHome}/pinga/learn.db`;
}

export function openLearnDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.run(CREATE_SESSION);
  db.run(CREATE_USER_TURNS);
  db.run(`PRAGMA user_version = ${LEARN_SCHEMA_VERSION}`);
  return db;
}

export type IngestOptions = {
  db: string;
  ledger?: string;
  evals?: string;
  sessions?: string;
  repo?: string;
  denylist?: string;
  // T16 — fontes multi-harness.
  piDir?: string;
  opencodeDb?: string;
  hermesDb?: string;
  frictionFile?: string;
  env?: Record<string, string | undefined>;
};

export type IngestResult = {
  exit: number;
  ingested: number;
  skipped: number;
  warnings: string[];
};

type SessionRow = Record<(typeof SESSION_COLUMNS)[number], string | number | null>;

function sha256hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function collectJsonlFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (curr: string): void => {
    for (const entry of readdirSync(curr, { withFileTypes: true })) {
      const p = join(curr, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out.sort(); // ordem de caminho
}

/** Estrita (I19/I4): tokens NULL nunca 0; texto livre só via redactExcerpt. */
export function ingest(opts: IngestOptions): IngestResult {
  const env = opts.env ?? process.env;
  const warnings: string[] = [];
  let ingested = 0;
  let skipped = 0;

  const fail = (exit: number, message: string): IngestResult => {
    console.error(message);
    return { exit, ingested, skipped, warnings };
  };

  const multiSourceSet =
    ((opts.piDir ?? "") !== "" ||
      (opts.opencodeDb ?? "") !== "" ||
      (opts.hermesDb ?? "") !== "" ||
      (opts.frictionFile ?? "") !== "");

  if (
    (opts.ledger ?? "") === "" &&
    (opts.evals ?? "") === "" &&
    (opts.sessions ?? "") === "" &&
    !multiSourceSet
  ) {
    return fail(
      LEARN_EXIT.usage,
      "learn ingest: nenhuma fonte informada (--ledger, --evals, --sessions, --pi, --opencode, --hermes, --friction)",
    );
  }

  let denylist: ReadonlySet<string> | undefined;
  if (opts.denylist !== undefined && opts.denylist !== "") {
    try {
      denylist = loadDenylist(opts.denylist);
    } catch (err) {
      return fail(
        LEARN_EXIT.usage,
        `learn ingest: denylist inválida: ${(err as Error).message}`,
      );
    }
  }

  // Item 2: canário de redação antes de abrir o learn.db; se falhar, nada
  // é criado e os valores não aparecem na mensagem.
  let canaryValues: readonly string[] = canary();
  const canaryFile = env.PINGA_REDACT_CANARY;
  if (canaryFile !== undefined && canaryFile !== "") {
    try {
      canaryValues = readFileSync(canaryFile, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim() !== "");
    } catch (err) {
      return fail(
        LEARN_EXIT.infra,
        `learn ingest: canário ilegível: ${(err as Error).message}`,
      );
    }
  }
  const canaryResult = canaryCheck(canaryValues, { denylist });
  if (!canaryResult.ok) {
    return fail(
      LEARN_EXIT.redaction_canary,
      `canário de redação falhou: ${canaryResult.survivors} valor(es) sobreviveram`,
    );
  }

  // Fonte ilegível → exit 8 antes de qualquer escrita.
  if (opts.ledger !== undefined && opts.ledger !== "" && !existsSync(opts.ledger)) {
    return fail(LEARN_EXIT.infra, `learn ingest: ledger não encontrado: ${opts.ledger}`);
  }
  if (opts.evals !== undefined && opts.evals !== "" && !existsSync(opts.evals)) {
    return fail(
      LEARN_EXIT.infra,
      `learn ingest: diretório de EVALs não encontrado: ${opts.evals}`,
    );
  }
  if (opts.sessions !== undefined && opts.sessions !== "" && !existsSync(opts.sessions)) {
    return fail(
      LEARN_EXIT.infra,
      `learn ingest: diretório de sessões não encontrado: ${opts.sessions}`,
    );
  }
  if (multiSourceSet) {
    if (
      opts.piDir !== undefined &&
      opts.piDir !== "" &&
      !existsSync(opts.piDir)
    ) {
      return fail(LEARN_EXIT.infra, `learn ingest: --pi não encontrado: ${opts.piDir}`);
    }
    if (
      opts.opencodeDb !== undefined &&
      opts.opencodeDb !== "" &&
      !existsSync(opts.opencodeDb)
    ) {
      return fail(
        LEARN_EXIT.infra,
        `learn ingest: --opencode não encontrado: ${opts.opencodeDb}`,
      );
    }
    if (
      opts.hermesDb !== undefined &&
      opts.hermesDb !== "" &&
      !existsSync(opts.hermesDb)
    ) {
      return fail(LEARN_EXIT.infra, `learn ingest: --hermes não encontrado: ${opts.hermesDb}`);
    }
    if (
      opts.frictionFile !== undefined &&
      opts.frictionFile !== "" &&
      !existsSync(opts.frictionFile)
    ) {
      return fail(
        LEARN_EXIT.infra,
        `learn ingest: --friction não encontrado: ${opts.frictionFile}`,
      );
    }
  }

  const dbPath =
    opts.db !== undefined && opts.db !== "" ? opts.db : defaultLearnDbPath(env);
  const absDb = resolve(dbPath);

  // Item 8 (I7): --db dentro de work tree git não ignorado → exit 2, nada criado.
  let probe = dirname(absDb);
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const top = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: probe,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (top.exitCode === 0) {
    const ignored = Bun.spawnSync(["git", "check-ignore", "-q", "--", absDb], {
      cwd: probe,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (ignored.exitCode !== 0) {
      return fail(
        LEARN_EXIT.usage,
        `learn ingest: --db dentro de repo git e não ignorado: ${absDb}`,
      );
    }
  }

  const now =
    env.PINGA_NOW !== undefined && env.PINGA_NOW !== ""
      ? env.PINGA_NOW
      : new Date().toISOString();

  const db = openLearnDb(absDb);
  try {
    const columns = [...SESSION_COLUMNS];
    const insertStmt = db.query(
      `INSERT INTO session (${columns.join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`,
    );
    const selectShaStmt = db.query(
      "SELECT source_sha256 FROM session WHERE id = ?",
    );
    const deleteStmt = db.query("DELETE FROM session WHERE id = ?");

    // Item 7 (idempotência): mesma id + mesmo sha → pulada (nada muda);
    // mesma id + sha diferente → substituída.
    const store = (row: SessionRow): void => {
      const existing = selectShaStmt.get(row.id) as {
        source_sha256: string;
      } | null;
      if (existing !== null && existing.source_sha256 === row.source_sha256) {
        skipped++;
        return;
      }
      if (existing !== null) deleteStmt.run(row.id);
      insertStmt.run(...columns.map((c) => row[c]));
      ingested++;
    };

    // Item 4: recibos do ledger.
    if (opts.ledger !== undefined && opts.ledger !== "") {
      const ledgerPath = resolve(opts.ledger);
      const ledger = openLedger(ledgerPath);
      let rows: Array<{ seq: number; hash: string; body: string }>;
      try {
        const v = ledger.verify();
        if (!v.ok) {
          return fail(
            LEARN_EXIT.infra,
            `learn ingest: ledger inválido (${ledgerPath}): quebrado em ${v.brokenAt}`,
          );
        }
        rows = ledger.all().map((r) => ({ seq: r.seq, hash: r.hash, body: r.body }));
      } finally {
        ledger.close();
      }
      for (const row of rows) {
        const r = JSON.parse(row.body) as Receipt;
        const model = r.author.model;
        const firstEvidence = r.evidence[0];
        store({
          id: `receipt:${r.id}`,
          kind: "receipt",
          harness: "pinga",
          source_path: `${ledgerPath}#${row.seq}`,
          source_sha256: row.hash,
          repo: opts.repo ?? null,
          task: r.task,
          started_at: r.created_at,
          ended_at: r.created_at,
          model,
          model_family: model === null ? null : modelFamily(model),
          tokens_in: r.tokens.in,
          tokens_out: r.tokens.out,
          tokens_cache: r.tokens.cache,
          verification:
            r.status === "pass" ? "pass" : r.status === "fail" ? "fail" : "not run",
          verification_evidence:
            firstEvidence === undefined ? null : `exit=${firstEvidence.exit}`,
          receipt_kind: receiptKind(r),
          status: r.status,
          reason_code: r.reason_code,
          attempts: r.attempts,
          rework_cycles: null,
          commits: null,
          excerpt: redactExcerpt(r.summary, { denylist }),
          ingested_at: now,
        });
      }
    }

    // Item 5: EVALs de tasks/*/EVAL.md.
    if (opts.evals !== undefined && opts.evals !== "") {
      const evalsDir = opts.evals;
      const entries = readdirSync(evalsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      for (const name of entries) {
        const evalPath = join(evalsDir, name, "EVAL.md");
        if (!existsSync(evalPath)) continue;
        const bytes = readFileSync(evalPath);
        const parsed = parseEval(bytes.toString("utf8"));
        if (!parsed.ok) {
          const msg = `learn ingest: EVAL inválido: ${evalPath}: ${parsed.errors.join("; ")}`;
          warnings.push(msg);
          console.error(msg);
          continue;
        }
        const doc = parsed.doc;
        const model = doc.executor.replace(/ \([^()]*\)$/, "");
        let tokensIn: number | null = null;
        let tokensOut: number | null = null;
        let tokensCache: number | null = null;
        if (doc.tokens !== "not run") {
          const m = doc.tokens.match(/^in=(\d+) out=(\d+) cache=(\d+|null) usd=/);
          if (m !== null) {
            tokensIn = Number(m[1]);
            tokensOut = Number(m[2]);
            tokensCache = m[3] === "null" ? null : Number(m[3]);
          }
        }
        store({
          id: `eval:${doc.task}`,
          kind: "eval",
          harness: "pinga",
          source_path: resolve(evalPath),
          source_sha256: sha256hex(bytes),
          repo: opts.repo ?? null,
          task: doc.task,
          started_at: null,
          ended_at: null,
          model,
          model_family: modelFamily(model),
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          tokens_cache: tokensCache,
          verification:
            doc.status === "pass" ? "pass" : doc.status === "fail" ? "fail" : "not run",
          verification_evidence: null,
          receipt_kind: null,
          status: null,
          reason_code: null,
          attempts: doc.attempts,
          rework_cycles: null,
          commits: null,
          excerpt: redactExcerpt(
            `parecer: ${doc.parecer} | bom: ${doc.dono.bom} | ruim: ${doc.dono.ruim} | mudar: ${doc.dono.mudar}`,
            { denylist },
          ),
          ingested_at: now,
        });
      }
    }

    // Item 6: transcripts do Claude Code.
    if (opts.sessions !== undefined && opts.sessions !== "") {
      for (const file of collectJsonlFiles(opts.sessions)) {
        const bytes = readFileSync(file);
        const summary = parseClaudeTranscript(bytes.toString("utf8"));
        const id = `claude:${
          summary.session_id ?? basename(file).replace(/\.jsonl$/, "")
        }`;
        const tokens = tokenFieldsFor(file).tokens;
        store({
          id,
          kind: "transcript",
          harness: "claude",
          source_path: resolve(file),
          source_sha256: sha256hex(bytes),
          repo: opts.repo ?? repoFromCwd(summary.cwd),
          task: null,
          started_at: summary.started_at,
          ended_at: summary.ended_at,
          model: summary.model,
          model_family:
            summary.model === null ? null : modelFamily(summary.model),
          tokens_in: tokens.in,
          tokens_out: tokens.out,
          tokens_cache: tokens.cache,
          verification: summary.verification,
          verification_evidence: redactExcerpt(summary.verification_evidence, {
            denylist,
          }),
          receipt_kind: null,
          status: null,
          reason_code: null,
          attempts: null,
          rework_cycles: summary.rework_cycles,
          commits: summary.commits,
          excerpt: redactExcerpt(summary.excerpt_source, { denylist }),
          ingested_at: now,
        });
      }
    }

    // T16: fontes multi-harness (pi, opencode, hermes, fricção).
    if (multiSourceSet) {
      const counts: MultiCounts = { forbiddenPathsBlocked: 0, blockedPaths: [] };
      const multiRows = collectMultiSources(
        {
          piDir: opts.piDir,
          opencodeDb: opts.opencodeDb,
          hermesDb: opts.hermesDb,
          frictionFile: opts.frictionFile,
        },
        counts,
        now,
      );
      for (const blocked of counts.blockedPaths) {
        warnings.push(
          `learn ingest: caminho proibido bloqueado (não lido): ${blocked}`,
        );
      }
      for (const row of multiRows) store(row);
    }
  } finally {
    db.close();
  }

  console.log(`ingested ${ingested} skipped ${skipped}`);
  return { exit: LEARN_EXIT.ok, ingested, skipped, warnings };
}

// ---------------------------------------------------------------------------
// T16 — ingestão multi-harness (pi, opencode, hermes, fricção)
// ---------------------------------------------------------------------------

export type MultiIngestOptions = {
  dbPath?: string;
  piDir?: string;
  opencodeDb?: string;
  hermesDb?: string;
  frictionFile?: string;
  dryRun?: boolean;
};

export type MultiIngestResult = {
  piSessionsIngested: number;
  opencodeSessionsIngested: number;
  hermesSessionsIngested: number;
  frictionEntriesIngested: number;
  forbiddenPathsBlocked: number;
};

type MultiCounts = {
  forbiddenPathsBlocked: number;
  blockedPaths: string[];
};

const NULL_MULTI_ROW: SessionRow = {
  id: "",
  kind: "transcript",
  harness: "",
  source_path: "",
  source_sha256: "",
  repo: null,
  task: null,
  started_at: null,
  ended_at: null,
  model: null,
  model_family: null,
  tokens_in: null,
  tokens_out: null,
  tokens_cache: null,
  verification: "none",
  verification_evidence: null,
  receipt_kind: null,
  status: null,
  reason_code: null,
  attempts: null,
  rework_cycles: null,
  commits: null,
  excerpt: null,
  ingested_at: "",
};

function walkEveryFile(dir: string): string[] {
  const out: string[] = [];
  const walk = (curr: string): void => {
    for (const entry of readdirSync(curr, { withFileTypes: true })) {
      const p = join(curr, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function readSourceBytes(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch {
    return null;
  }
}

function hasValue(v: string | undefined): v is string {
  return v !== undefined && v !== "";
}

/**
 * Converte as fontes multi-harness em linhas da tabela `session`. Caminhos
 * proibidos (isForbiddenPath) são contados e NUNCA abertos/lidos. Todo texto
 * persistido passa por redactExcerpt antes de virar linha.
 */
function collectMultiSources(
  opts: Pick<MultiIngestOptions, "piDir" | "opencodeDb" | "hermesDb" | "frictionFile">,
  counts: MultiCounts,
  now: string,
): SessionRow[] {
  const rows: SessionRow[] = [];
  const block = (path: string): void => {
    counts.forbiddenPathsBlocked++;
    counts.blockedPaths.push(path);
  };

  if (hasValue(opts.piDir) && existsSync(opts.piDir)) {
    for (const file of walkEveryFile(opts.piDir)) {
      if (isForbiddenPath(file)) {
        block(file); // nunca lido
        continue;
      }
      if (!file.endsWith(".jsonl")) continue;
      const bytes = readSourceBytes(file);
      if (bytes === null) continue;
      const s = parsePiSession(file);
      rows.push({
        ...NULL_MULTI_ROW,
        id: `pi:${s.id}`,
        harness: "pi",
        source_path: resolve(file),
        source_sha256: sha256hex(bytes),
        repo: s.repo,
        started_at: s.started_at,
        ended_at: s.ended_at,
        model: s.model,
        model_family: s.model_family,
        tokens_in: s.tokens_in,
        tokens_out: s.tokens_out,
        tokens_cache: s.tokens_cache,
        verification: s.verification,
        verification_evidence: redactExcerpt(s.verification_evidence),
        ingested_at: now,
      });
    }
  }

  // Fontes SQLite: o sha é do arquivo inteiro (idempotência por source_sha256).
  const dbSource = (
    dbPath: string | undefined,
    harness: "opencode" | "hermes",
    parse: (p: string) => Array<{
      id: string;
      repo: string | null;
      model: string | null;
      tokens_in: number | null;
      tokens_out: number | null;
      tokens_cache: number | null;
      verification: "pass" | "fail" | "none" | "not run";
    }>,
  ): void => {
    if (!hasValue(dbPath)) return;
    if (isForbiddenPath(dbPath)) {
      block(dbPath); // nunca aberto
      return;
    }
    if (!existsSync(dbPath)) return;
    const bytes = readSourceBytes(dbPath);
    if (bytes === null) return;
    const sha = sha256hex(bytes);
    for (const s of parse(dbPath)) {
      rows.push({
        ...NULL_MULTI_ROW,
        id: `${harness}:${s.id}`,
        harness,
        source_path: resolve(dbPath),
        source_sha256: sha,
        repo: s.repo,
        model: s.model,
        model_family: s.model === null ? null : modelFamily(s.model),
        tokens_in: s.tokens_in,
        tokens_out: s.tokens_out,
        tokens_cache: s.tokens_cache,
        verification: s.verification,
        ingested_at: now,
      });
    }
  };
  dbSource(opts.opencodeDb, "opencode", parseOpencodeDb);
  dbSource(opts.hermesDb, "hermes", parseHermesDb);

  if (hasValue(opts.frictionFile)) {
    if (isForbiddenPath(opts.frictionFile)) {
      block(opts.frictionFile); // nunca lido
    } else if (existsSync(opts.frictionFile)) {
      const bytes = readSourceBytes(opts.frictionFile);
      if (bytes !== null) {
        const sha = sha256hex(bytes);
        for (const e of parseFrictionMarkdown(opts.frictionFile)) {
          rows.push({
            ...NULL_MULTI_ROW,
            id: `friction:${e.id}`,
            harness: "friction",
            source_path: resolve(opts.frictionFile),
            source_sha256: sha,
            excerpt: redactExcerpt(
              `Pattern: ${e.pattern} | Evidence: ${e.evidence} | Action: ${e.suggested_action}`,
            ),
            ingested_at: now,
          });
        }
      }
    }
  }

  return rows;
}

/**
 * Item 8 (T16): idempotência por id + source_sha256 — mesma id com o mesmo sha
 * é pulada; sha diferente substitui. Retorna quantas linhas foram inseridas,
 * por harness.
 */
function persistMultiRows(db: Database, rows: readonly SessionRow[]): Record<string, number> {
  const columns = [...SESSION_COLUMNS];
  const insertStmt = db.query(
    `INSERT INTO session (${columns.join(", ")}) VALUES (${columns
      .map(() => "?")
      .join(", ")})`,
  );
  const selectShaStmt = db.query(
    "SELECT source_sha256 FROM session WHERE id = ?",
  );
  const deleteStmt = db.query("DELETE FROM session WHERE id = ?");

  const byHarness: Record<string, number> = {};
  for (const row of rows) {
    const existing = selectShaStmt.get(row.id) as {
      source_sha256: string;
    } | null;
    if (existing !== null && existing.source_sha256 === row.source_sha256) {
      continue;
    }
    if (existing !== null) deleteStmt.run(row.id);
    insertStmt.run(...columns.map((c) => row[c]));
    byHarness[row.harness] = (byHarness[row.harness] ?? 0) + 1;
  }
  return byHarness;
}

/** Núcleo síncrono da ingestão multi-harness; `ingestMultiHarness` é o wrapper. */
export function ingestMultiHarnessSync(opts: MultiIngestOptions): MultiIngestResult {
  // Item 1/RED §1.1.2: canário de redação ANTES de qualquer inserção SQL.
  const canaryResult = canaryCheck(canary());
  if (!canaryResult.ok) {
    throw new Error(
      `canário de redação falhou: ${canaryResult.survivors} valor(es) sobreviveram`,
    );
  }

  const counts: MultiCounts = { forbiddenPathsBlocked: 0, blockedPaths: [] };
  const now =
    process.env.PINGA_NOW !== undefined && process.env.PINGA_NOW !== ""
      ? process.env.PINGA_NOW
      : new Date().toISOString();
  const rows = collectMultiSources(opts, counts, now);

  let byHarness: Record<string, number> = {};
  if (opts.dryRun !== true) {
    const dbPath =
      hasValue(opts.dbPath) ? opts.dbPath : defaultLearnDbPath(process.env);
    const db = openLearnDb(resolve(dbPath));
    try {
      byHarness = persistMultiRows(db, rows);
    } finally {
      db.close();
    }
  }

  return {
    piSessionsIngested: byHarness["pi"] ?? 0,
    opencodeSessionsIngested: byHarness["opencode"] ?? 0,
    hermesSessionsIngested: byHarness["hermes"] ?? 0,
    frictionEntriesIngested: byHarness["friction"] ?? 0,
    forbiddenPathsBlocked: counts.forbiddenPathsBlocked,
  };
}

export async function ingestMultiHarness(
  opts: MultiIngestOptions,
): Promise<MultiIngestResult> {
  return ingestMultiHarnessSync(opts);
}

export function ingestUserTurns(
  db: Database,
  sessionId: string,
  turns: Array<{
    text: string;
    is_sidechain?: boolean | number;
    is_subagent?: boolean | number;
    preceding_tool_failed?: boolean;
  }>,
): number {
  const insertStmt = db.query(
    `INSERT INTO user_turns (session_id, text, is_human, has_correction_marker, preceding_tool_failed)
     VALUES (?, ?, ?, ?, ?)`,
  );
  let count = 0;
  for (const turn of turns) {
    const raw = typeof turn.text === "string" ? turn.text : "";
    const trimmed = raw.trim();
    const redacted = redactExcerpt(raw) ?? "";
    const is_human =
      turn.is_sidechain !== true &&
      turn.is_sidechain !== 1 &&
      turn.is_subagent !== true &&
      (turn as Record<string, unknown>).is_subagent !== 1 &&
      !/^(\s*<TASK>|\s*<SYSTEM_MESSAGE>|\s*\[Message\])/i.test(trimmed) &&
      trimmed.length > 0 &&
      trimmed.length <= 400
        ? 1
        : 0;
    const has_correction_marker = CORRECTION_MARKERS_PT_EN.test(trimmed) ? 1 : 0;
    const preceding_tool_failed = turn.preceding_tool_failed === true ? 1 : 0;
    insertStmt.run(
      sessionId,
      redacted,
      is_human,
      has_correction_marker,
      preceding_tool_failed,
    );
    count++;
  }
  return count;
}
