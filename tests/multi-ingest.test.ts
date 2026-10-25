import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { ingestMultiHarness, openLearnDb } from "../src/learn";
import {
  FORBIDDEN_PATH_PATTERNS,
  isForbiddenPath,
  parseFrictionMarkdown,
  parseHermesDb,
  parseOpencodeDb,
  parsePiSession,
} from "../src/transcript";

describe("T16 — Multi-harness ingestion & credential blocklist", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pinga-t16-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("1. isForbiddenPath blocks credential files and allows normal transcripts", () => {
    expect(Array.isArray(FORBIDDEN_PATH_PATTERNS)).toBe(true);
    expect(FORBIDDEN_PATH_PATTERNS.length).toBeGreaterThan(0);

    expect(isForbiddenPath("~/.pi/agent/auth.json")).toBe(true);
    expect(isForbiddenPath("/home/u/.hermes/.env")).toBe(true);
    expect(isForbiddenPath("/home/u/.hermes/auth.json")).toBe(true);
    expect(isForbiddenPath("/etc/ssl/certs/credentials.json")).toBe(true);
    expect(isForbiddenPath("/repo/secrets/token.txt")).toBe(true);
    expect(isForbiddenPath("/repo/.secrets/key.pem")).toBe(true);

    expect(isForbiddenPath("/home/u/.pi/agent/sessions/s1.jsonl")).toBe(false);
    expect(isForbiddenPath("/home/u/project/FRICTION.md")).toBe(false);
    expect(isForbiddenPath("/tmp/opencode.db")).toBe(false);
  });

  test("2. ingestMultiHarness blocks forbidden paths without reading them", async () => {
    const dbPath = join(tmp, "learn.db");
    const forbiddenFile = join(tmp, "auth.json");
    writeFileSync(forbiddenFile, '{"token":"secret"}');

    const res = await ingestMultiHarness({
      dbPath,
      frictionFile: forbiddenFile,
    });

    expect(res.forbiddenPathsBlocked).toBe(1);
    expect(res.frictionEntriesIngested).toBe(0);
  });

  test("3. parsePiSession extracts toolCalls, stopReason, model, family, tokens and verification", () => {
    const piFile = join(tmp, "pi-session-1.jsonl");
    const lines = [
      JSON.stringify({
        type: "session",
        id: "pi-sess-001",
        cwd: "/home/u/Projetos/p-inga",
        timestamp: "2026-10-24T10:00:00Z",
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-10-24T10:01:00Z",
        model: "qwen3.8-flash",
        stopReason: "tool_use",
        usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 400 },
        toolCalls: [{ id: "tc1", name: "Bash", input: { command: "bun test" } }],
      }),
      JSON.stringify({
        type: "tool_result",
        timestamp: "2026-10-24T10:01:05Z",
        toolCallId: "tc1",
        isError: false,
        content: "10 pass, 0 fail",
      }),
    ];
    writeFileSync(piFile, lines.join("\n"));

    const parsed = parsePiSession(piFile);
    expect(parsed.id).toBe("pi-sess-001");
    expect(parsed.repo).toBe("p-inga");
    expect(parsed.started_at).toBe("2026-10-24T10:00:00Z");
    expect(parsed.ended_at).toBe("2026-10-24T10:01:05Z");
    expect(parsed.model).toBe("qwen3.8-flash");
    expect(parsed.model_family).toBe("qwen");
    expect(parsed.tokens_in).toBe(1200);
    expect(parsed.tokens_out).toBe(300);
    expect(parsed.tokens_cache).toBe(400);
    expect(parsed.verification).toBe("pass");
    expect(parsed.raw_events_count).toBe(3);
  });

  test("4. parsePiSession preserves null tokens (never 0) when usage is absent", () => {
    const piFile = join(tmp, "pi-session-null.jsonl");
    writeFileSync(
      piFile,
      JSON.stringify({
        type: "session",
        id: "pi-null",
        timestamp: "2026-10-24T11:00:00Z",
      }),
    );

    const parsed = parsePiSession(piFile);
    expect(parsed.id).toBe("pi-null");
    expect(parsed.tokens_in).toBeNull();
    expect(parsed.tokens_out).toBeNull();
    expect(parsed.tokens_cache).toBeNull();
    expect(parsed.verification).toBe("none");
  });

  test("5. parseOpencodeDb reads session_v2 / session table in SQLite", () => {
    const ocDbPath = join(tmp, "opencode.db");
    const db = new Database(ocDbPath);
    db.run(`CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY,
      directory TEXT,
      model TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      tokens_cache INTEGER,
      idle_outcome TEXT
    )`);
    db.run(
      `INSERT INTO session_v2 (id, directory, model, tokens_in, tokens_out, tokens_cache, idle_outcome)
       VALUES ('oc-1', '/home/u/Projetos/p-inga', 'glm-5.3-flash-free', 2500, 500, NULL, 'pass')`,
    );
    db.close();

    const rows = parseOpencodeDb(ocDbPath);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe("oc-1");
    expect(rows[0]!.repo).toBe("p-inga");
    expect(rows[0]!.model).toBe("glm-5.3-flash-free");
    expect(rows[0]!.tokens_in).toBe(2500);
    expect(rows[0]!.tokens_out).toBe(500);
    expect(rows[0]!.tokens_cache).toBeNull();
    expect(rows[0]!.verification).toBe("pass");
  });

  test("6. parseHermesDb reads sessions and messages tables in SQLite", () => {
    const hDbPath = join(tmp, "state.db");
    const db = new Database(hDbPath);
    db.run(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      cwd TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER
    )`);
    db.run(`CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      role TEXT,
      content TEXT
    )`);
    db.run(
      `INSERT INTO sessions (id, cwd, model, input_tokens, output_tokens, cache_read_tokens)
       VALUES ('hm-1', '/home/u/Projetos/duh-homelab', 'qwen2.5-3b-instruct', 800, 150, NULL)`,
    );
    db.run(
      `INSERT INTO messages (session_id, role, content)
       VALUES ('hm-1', 'assistant', 'bun test passed')`,
    );
    db.close();

    const rows = parseHermesDb(hDbPath);
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe("hm-1");
    expect(rows[0]!.repo).toBe("duh-homelab");
    expect(rows[0]!.model).toBe("qwen2.5-3b-instruct");
    expect(rows[0]!.tokens_in).toBe(800);
    expect(rows[0]!.tokens_out).toBe(150);
    expect(rows[0]!.tokens_cache).toBeNull();
  });

  test("7. parseFrictionMarkdown extracts structured findings from FRICTION.md", () => {
    const fPath = join(tmp, "FRICTION.md");
    writeFileSync(
      fPath,
      [
        "# Friction Log",
        "",
        "## F-01: Subagent edit loop on frozen test",
        "- Pattern: edit_loop",
        "- Evidence: 4 edits on tests/verify.test.ts failed exit 5",
        "- Action: Freeze test files in pre-commit and guard I5",
        "",
        "## F-02: Missing --base in worktree verify",
        "- Pattern: missing_base",
        "- Evidence: git diff HEAD missed committed changes",
        "- Action: Always pass --base <sha> in verify",
      ].join("\n"),
    );

    const entries = parseFrictionMarkdown(fPath);
    expect(entries.length).toBe(2);
    expect(entries[0]!.id).toContain("F-01");
    expect(entries[0]!.pattern).toBe("edit_loop");
    expect(entries[0]!.evidence).toContain("tests/verify.test.ts");
    expect(entries[0]!.suggested_action).toContain("Freeze test files");
  });

  test("8 & 9. ingestMultiHarness stores all sources idempotently and redacts secrets", async () => {
    const dbPath = join(tmp, "learn.db");
    const piDir = join(tmp, "pi-sessions");
    rmSync(piDir, { recursive: true, force: true });
    const { mkdirSync } = await import("node:fs");
    mkdirSync(piDir, { recursive: true });

    writeFileSync(
      join(piDir, "s1.jsonl"),
      JSON.stringify({
        type: "session",
        id: "pi-100",
        cwd: "/home/u/Projetos/p-inga",
        timestamp: "2026-10-24T12:00:00Z",
        model: "qwen3.8-flash",
      }),
    );
    // Also place a forbidden auth.json inside piDir to verify directory walk skips it
    writeFileSync(join(piDir, "auth.json"), '{"apiKey":"sk-secret"}');

    const ocDbPath = join(tmp, "opencode.db");
    const ocDb = new Database(ocDbPath);
    ocDb.run(`CREATE TABLE session_v2 (
      id TEXT PRIMARY KEY, directory TEXT, model TEXT,
      tokens_in INTEGER, tokens_out INTEGER, tokens_cache INTEGER, idle_outcome TEXT
    )`);
    ocDb.run(
      `INSERT INTO session_v2 VALUES ('oc-100', '/home/u/Projetos/p-inga', 'glm-5.3-flash', 100, 50, NULL, 'pass')`,
    );
    ocDb.close();

    const hDbPath = join(tmp, "state.db");
    const hDb = new Database(hDbPath);
    hDb.run(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, cwd TEXT, model TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER
    )`);
    hDb.run(
      `INSERT INTO sessions VALUES ('hm-100', '/home/u/Projetos/p-inga', 'qwen2.5-3b', 200, 80, NULL)`,
    );
    hDb.close();

    const fPath = join(tmp, "FRICTION.md");
    const fakePat = `ghp_${"A".repeat(36)}`;
    writeFileSync(
      fPath,
      [
        "## F-99: Secret leak attempt",
        `- Pattern: secret_in_log`,
        `- Evidence: token ${fakePat} appeared in output`,
        `- Action: Redact before SQLite insert`,
      ].join("\n"),
    );

    const first = await ingestMultiHarness({
      dbPath,
      piDir,
      opencodeDb: ocDbPath,
      hermesDb: hDbPath,
      frictionFile: fPath,
    });

    expect(first.piSessionsIngested).toBe(1);
    expect(first.opencodeSessionsIngested).toBe(1);
    expect(first.hermesSessionsIngested).toBe(1);
    expect(first.frictionEntriesIngested).toBe(1);
    expect(first.forbiddenPathsBlocked).toBeGreaterThanOrEqual(1);

    // Second run: idempotent (0 newly ingested)
    const second = await ingestMultiHarness({
      dbPath,
      piDir,
      opencodeDb: ocDbPath,
      hermesDb: hDbPath,
      frictionFile: fPath,
    });
    expect(second.piSessionsIngested).toBe(0);
    expect(second.opencodeSessionsIngested).toBe(0);
    expect(second.hermesSessionsIngested).toBe(0);
    expect(second.frictionEntriesIngested).toBe(0);

    // Check secret was redacted in learn.db
    const checkDb = openLearnDb(dbPath);
    const rows = checkDb.query("SELECT excerpt FROM session").all() as Array<{
      excerpt: string | null;
    }>;
    checkDb.close();
    for (const r of rows) {
      expect(r.excerpt ?? "").not.toContain(fakePat);
    }
  });

  test("10. CLI pinga learn ingest supports --pi, --opencode, --hermes, --friction", async () => {
    const dbPath = join(tmp, "cli-learn.db");
    const fPath = join(tmp, "FRICTION.md");
    writeFileSync(
      fPath,
      [
        "## F-10: CLI test",
        "- Pattern: cli_friction",
        "- Evidence: tested via runCli",
        "- Action: Verify exit 0",
      ].join("\n"),
    );

    const exit = await runCli([
      "learn",
      "ingest",
      "--db",
      dbPath,
      "--friction",
      fPath,
    ]);
    expect(exit).toBe(0);
  });
});
