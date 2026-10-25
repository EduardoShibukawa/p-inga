import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { openLedger } from "../src/ledger";
import {
  LEARN_EXIT,
  LEARN_SCHEMA_VERSION,
  SESSION_COLUMNS,
  defaultLearnDbPath,
  ingest,
  openLearnDb,
} from "../src/learn";
import type { Receipt } from "../src/receipt";
import { redact } from "../src/redact";
import { NOT_RUN_TOKENS, tokenFieldsFor } from "../src/tokens";
import {
  EDIT_TOOLS,
  TEST_CMD_RE,
  parseClaudeTranscript,
  repoFromCwd,
} from "../src/transcript";
import { makeRealisticHome, runPinga, tmp } from "./helpers/home";

function cleanupFakeEnv(f: ReturnType<typeof makeRealisticHome>) {
  rmSync(f.home, { recursive: true, force: true });
  rmSync(f.state, { recursive: true, force: true });
  rmSync(f.tmpdir, { recursive: true, force: true });
  rmSync(f.source, { recursive: true, force: true });
}

function makeReceipt(overrides: Partial<Receipt> & { id: string; task: string }): Receipt {
  return {
    v: 1,
    type: "task.receipt",
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [
      {
        kind: "command",
        cmd_sha256: "a".repeat(64),
        exit: 0,
        duration_ms: 10,
        artifact_ref: { path: "runs/TX/1/out.txt", sha256: "b".repeat(64) },
      },
    ],
    tokens: NOT_RUN_TOKENS.tokens,
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: "glm-5.3-flash-free", family: "glm" },
    verified_by: null,
    summary: "TX pass",
    created_at: "2026-10-24T12:00:00.000Z",
    ...overrides,
  };
}

describe("T14 — learn.db e ingestão de recibos, EVAL e transcripts (I19) — tests/learn.test.ts", () => {
  test("10 & 11. Schema SQLite, constraints e defaultLearnDbPath", () => {
    expect(LEARN_SCHEMA_VERSION).toBe(1);
    expect(LEARN_EXIT).toEqual({
      ok: 0,
      usage: 2,
      infra: 8,
      redaction_canary: 15,
    });
    expect(EDIT_TOOLS).toEqual([
      "Edit",
      "MultiEdit",
      "Write",
      "NotebookEdit",
    ]);
    expect(TEST_CMD_RE.test("bun test")).toBe(true);

    const d = tmp("pinga-t14-schema-");
    try {
      const dbPath = join(d, "learn.db");
      const db = openLearnDb(dbPath);
      try {
        const info = db
          .query("PRAGMA table_info(session)")
          .all() as Array<{ name: string }>;
        expect(info.map((c) => c.name)).toEqual([...SESSION_COLUMNS]);

        const uv = db.query("PRAGMA user_version").get() as {
          user_version: number;
        };
        expect(uv.user_version).toBe(1);

        // Constraints CHECK
        expect(() =>
          db
            .query(
              "INSERT INTO session (id, kind, harness, source_path, source_sha256, verification, ingested_at) VALUES ('1','receipt','pinga','p','s','ok','now')",
            )
            .run(),
        ).toThrow();

        expect(() =>
          db
            .query(
              "INSERT INTO session (id, kind, harness, source_path, source_sha256, verification, ingested_at) VALUES ('2','receipt','pinga','p','s',NULL,'now')",
            )
            .run(),
        ).toThrow();

        expect(() =>
          db
            .query(
              "INSERT INTO session (id, kind, harness, source_path, source_sha256, verification, excerpt, ingested_at) VALUES ('3','receipt','pinga','p','s','pass',?,'now')",
            )
            .run("x".repeat(301)),
        ).toThrow();

        expect(() =>
          db
            .query(
              "INSERT INTO session (id, kind, harness, source_path, source_sha256, verification, ingested_at) VALUES ('4','x','pinga','p','s','pass','now')",
            )
            .run(),
        ).toThrow();
      } finally {
        db.close();
      }

      // 11. defaultLearnDbPath
      expect(
        defaultLearnDbPath({
          PINGA_LEARN_DB: "/custom/l.db",
          XDG_STATE_HOME: "/xdg",
          HOME: "/h",
        }),
      ).toBe("/custom/l.db");
      expect(
        defaultLearnDbPath({
          XDG_STATE_HOME: "/xdg",
          HOME: "/h",
        }),
      ).toBe("/xdg/pinga/learn.db");
      expect(defaultLearnDbPath({ HOME: "/h" })).toBe(
        "/h/.local/state/pinga/learn.db",
      );
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("12, 13, 14, 15, 16, 19. Ingestão de recibos, idempotência, ledger inválido, EVAL, transcripts Claude e ausência de vazamento", () => {
    const f = makeRealisticHome();
    try {
      const dbPath = join(f.state, "pinga/learn.db");
      const ledgerPath = join(f.tmpdir, "ledger.db");
      const ghToken = "ghp_" + "FAKE".repeat(9);
      const awsToken = "AKIA" + "FAKE".repeat(4);
      const antToken = "sk-ant-api03-" + "FAKE".repeat(10) + "-AAAA";

      // 12. 4 recibos no ledger
      const ledger = openLedger(ledgerPath);
      try {
        ledger.append(
          makeReceipt({
            id: "r-a",
            task: "T01",
            status: "pass",
            reason_code: null,
            author: { model: "glm-5.3-flash-free", family: "glm" },
            tokens: { in: 10, out: 2, cache: null, source: "host-structured" },
            cost_evidence: "usage-file:a",
          }),
        );
        ledger.append(
          makeReceipt({
            id: "r-b",
            task: "T02",
            status: "fail",
            reason_code: "command_failed",
            summary: `T02 fail: vazou ${ghToken} no log`,
          }),
        );
        ledger.append(
          makeReceipt({
            id: "r-c",
            task: "T03",
            status: "blocked",
            reason_code: "breaker_same_failure",
            author: { model: null, family: null },
          }),
        );
        ledger.append(
          makeReceipt({
            id: "r-d",
            task: "T04",
            status: "pass",
            reason_code: null,
            flow: "judge",
          }),
        );
      } finally {
        ledger.close();
      }

      const r12 = runPinga(
        ["learn", "ingest", "--ledger", ledgerPath, "--db", dbPath],
        f.env,
      );
      expect(r12.exit).toBe(0);
      expect(r12.stdout.trim()).toBe("ingested 4 skipped 0");

      let db = openLearnDb(dbPath);
      try {
        const rows = db
          .query("SELECT * FROM session WHERE kind = 'receipt' ORDER BY id")
          .all() as Array<Record<string, unknown>>;
        expect(rows.length).toBe(4);

        const rowA = rows.find((r) => r.id === "receipt:r-a")!;
        expect(rowA.tokens_in).toBe(10);
        expect(rowA.tokens_out).toBe(2);
        expect(rowA.tokens_cache).toBeNull();
        expect(rowA.verification).toBe("pass");
        expect(rowA.model_family).toBe("glm");

        const rowB = rows.find((r) => r.id === "receipt:r-b")!;
        expect(rowB.tokens_in).toBeNull();
        expect(rowB.tokens_out).toBeNull();
        expect(rowB.tokens_cache).toBeNull();
        expect(rowB.verification).toBe("fail");
        expect(String(rowB.excerpt)).toContain("[REDACTED:github]");
        expect(String(rowB.excerpt).includes("ghp_")).toBe(false);

        const rowC = rows.find((r) => r.id === "receipt:r-c")!;
        expect(rowC.verification).toBe("not run");
        expect(rowC.model).toBeNull();
        expect(rowC.model_family).toBeNull();

        const rowD = rows.find((r) => r.id === "receipt:r-d")!;
        expect(rowD.receipt_kind).toBe("judge");

        const zeroCount = db
          .query(
            "SELECT count(*) as c FROM session WHERE tokens_in = 0 OR tokens_out = 0 OR tokens_cache = 0",
          )
          .get() as { c: number };
        expect(zeroCount.c).toBe(0);
      } finally {
        db.close();
      }

      // 13. Idempotência
      db = openLearnDb(dbPath);
      const snapshotBefore = db
        .query("SELECT * FROM session ORDER BY id")
        .all();
      db.close();

      const r13a = runPinga(
        ["learn", "ingest", "--ledger", ledgerPath, "--db", dbPath],
        { ...f.env, PINGA_NOW: "2026-10-25T00:00:00.000Z" },
      );
      expect(r13a.exit).toBe(0);
      expect(r13a.stdout.trim()).toBe("ingested 0 skipped 4");

      db = openLearnDb(dbPath);
      expect(db.query("SELECT * FROM session ORDER BY id").all()).toEqual(
        snapshotBefore,
      );
      db.close();

      // 5º recibo no ledger -> ingested 1 skipped 4
      const l2 = openLedger(ledgerPath);
      l2.append(makeReceipt({ id: "r-e", task: "T05" }));
      l2.close();
      const r13b = runPinga(
        ["learn", "ingest", "--ledger", ledgerPath, "--db", dbPath],
        f.env,
      );
      expect(r13b.exit).toBe(0);
      expect(r13b.stdout.trim()).toBe("ingested 1 skipped 4");

      // 14. Ledger inexistente -> exit 8 e arquivo continua inexistente; ledger adulterado -> exit 8
      const missingLedger = join(f.tmpdir, "missing-ledger.db");
      const r14a = runPinga(
        ["learn", "ingest", "--ledger", missingLedger, "--db", dbPath],
        f.env,
      );
      expect(r14a.exit).toBe(8);
      expect(existsSync(missingLedger)).toBe(false);

      const badLedgerPath = join(f.tmpdir, "bad-ledger.db");
      const bl = openLedger(badLedgerPath);
      bl.append(makeReceipt({ id: "r-bad", task: "T99" }));
      bl.close();
      const { Database } = require("bun:sqlite");
      const rawDb = new Database(badLedgerPath);
      rawDb.exec("DROP TRIGGER IF EXISTS receipts_no_update;");
      rawDb.exec("UPDATE receipts SET body = 'corrompido' WHERE seq = 1;");
      rawDb.close();

      const r14b = runPinga(
        ["learn", "ingest", "--ledger", badLedgerPath, "--db", dbPath],
        f.env,
      );
      expect(r14b.exit).toBe(8);

      // 15. EVAL
      const evalsDir = join(f.tmpdir, "evals");
      mkdirSync(join(evalsDir, "T90"), { recursive: true });
      mkdirSync(join(evalsDir, "T91"), { recursive: true });
      mkdirSync(join(evalsDir, "T92"), { recursive: true });

      const t90Path = join(evalsDir, "T90/EVAL.md");
      writeFileSync(
        t90Path,
        [
          "## EVAL T90",
          "executor: opencode/glm-5.3-flash-free (glm) · planejador: claude-opus-5-5 (claude)",
          "auto:   status pass · tentativas 1 · tempo 1 min · tokens in=5471 out=11 cache=null usd=null",
          "escopo: tests_frozen intacto · fora do touch: nenhum",
          `parecer: T90 pass com ${awsToken}`,
          "dono:",
          "  bom: tudo certo",
          "  ruim: nada",
          "  mudar: manter",
        ].join("\n") + "\n",
      );
      writeFileSync(
        join(evalsDir, "T91/EVAL.md"),
        [
          "## EVAL T91",
          "executor: opencode/glm-5.3-flash-free (glm) · planejador: claude-opus-5-5 (claude)",
          "auto:   status fail · tentativas 2 · tempo 1 min · tokens not run",
          "escopo: tests_frozen intacto · fora do touch: nenhum",
          "parecer: T91 fail",
          "dono:",
          "  bom: b",
          "  ruim: r",
          "  mudar: m",
        ].join("\n") + "\n",
      );
      writeFileSync(join(evalsDir, "T92/EVAL.md"), "invalido\n");

      const r15 = runPinga(
        ["learn", "ingest", "--evals", evalsDir, "--db", dbPath],
        f.env,
      );
      expect(r15.exit).toBe(0);
      expect(r15.stderr).toContain("T92");

      db = openLearnDb(dbPath);
      try {
        const e90 = db
          .query("SELECT * FROM session WHERE id = 'eval:T90'")
          .get() as Record<string, unknown>;
        expect(e90.tokens_in).toBe(5471);
        expect(e90.tokens_out).toBe(11);
        expect(e90.tokens_cache).toBeNull();
        expect(e90.model_family).toBe("glm");
        expect(String(e90.excerpt).includes("AKIA")).toBe(false);

        const e91 = db
          .query("SELECT * FROM session WHERE id = 'eval:T91'")
          .get() as Record<string, unknown>;
        expect(e91.tokens_in).toBeNull();
        expect(e91.tokens_out).toBeNull();
        expect(e91.tokens_cache).toBeNull();
      } finally {
        db.close();
      }

      // Reingestão igual -> pulada; mudar bom: de T90 -> ingested 1, mesma contagem
      const r15b = runPinga(
        ["learn", "ingest", "--evals", evalsDir, "--db", dbPath],
        f.env,
      );
      expect(r15b.stdout.trim()).toBe("ingested 0 skipped 2");

      writeFileSync(
        t90Path,
        readFileSync(t90Path, "utf8").replace("bom: tudo certo", "bom: melhor"),
      );
      const r15c = runPinga(
        ["learn", "ingest", "--evals", evalsDir, "--db", dbPath],
        f.env,
      );
      expect(r15c.stdout.trim()).toBe("ingested 1 skipped 1");

      // 16. Transcripts Claude
      expect(repoFromCwd("/r/pi-harness/.worktrees/fix-0047/src")).toBe(
        "pi-harness@fix-0047",
      );
      expect(repoFromCwd(null)).toBeNull();

      const sessDir = join(f.tmpdir, "sessions/-tmp-proj");
      mkdirSync(sessDir, { recursive: true });
      const s1Path = join(sessDir, "s1.jsonl");
      const s1Lines = [
        {
          sessionId: "s1",
          cwd: "/tmp/x/proj",
          timestamp: "2026-10-24T10:00:00.000Z",
          type: "user",
          message: { role: "user", content: "implemente a feature" },
        },
        {
          sessionId: "s1",
          cwd: "/tmp/x/proj",
          timestamp: "2026-10-24T10:01:00.000Z",
          type: "assistant",
          message: {
            model: "claude-opus-5-5",
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 5,
            },
            content: [
              {
                type: "tool_use",
                id: "tu1",
                name: "Bash",
                input: { command: "bun test" },
              },
            ],
          },
        },
        {
          sessionId: "s1",
          timestamp: "2026-10-24T10:01:05.000Z",
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tu1",
                is_error: true,
                content: `falhou com ${antToken}`,
              },
            ],
          },
        },
        {
          sessionId: "s1",
          timestamp: "2026-10-24T10:02:00.000Z",
          type: "assistant",
          message: {
            model: "claude-opus-5-5",
            content: [
              { type: "tool_use", id: "tu2", name: "Edit", input: {} },
              {
                type: "tool_use",
                id: "tu3",
                name: "Bash",
                input: { command: "bun test" },
              },
            ],
          },
        },
        {
          sessionId: "s1",
          timestamp: "2026-10-24T10:02:05.000Z",
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tu3",
                is_error: true,
                content: "erro 2",
              },
            ],
          },
        },
        {
          sessionId: "s1",
          timestamp: "2026-10-24T10:03:00.000Z",
          type: "assistant",
          message: {
            model: "claude-opus-5-5",
            content: [
              { type: "tool_use", id: "tu4", name: "Write", input: {} },
              {
                type: "tool_use",
                id: "tu5",
                name: "Bash",
                input: { command: "bun test" },
              },
            ],
          },
        },
        {
          sessionId: "s1",
          timestamp: "2026-10-24T10:03:05.000Z",
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tu5",
                is_error: true,
                content: "erro 3",
              },
            ],
          },
        },
        {
          sessionId: "s1",
          timestamp: "2026-10-24T10:04:00.000Z",
          type: "assistant",
          message: {
            model: "claude-opus-5-5",
            content: [
              { type: "tool_use", id: "tu6", name: "Edit", input: {} },
              {
                type: "tool_use",
                id: "tu7",
                name: "Bash",
                input: { command: "bun test" },
              },
            ],
          },
        },
        {
          sessionId: "s1",
          timestamp: "2026-10-24T10:04:05.000Z",
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tu7",
                is_error: false,
                content: "passou",
              },
            ],
          },
        },
        {
          sessionId: "s1",
          timestamp: "2026-10-24T10:05:00.000Z",
          type: "assistant",
          message: {
            model: "claude-opus-5-5",
            content: [
              {
                type: "tool_use",
                id: "tu8",
                name: "Bash",
                input: { command: "git commit -m x" },
              },
            ],
          },
        },
        {
          sessionId: "s1",
          timestamp: "2026-10-24T10:05:05.000Z",
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tu8",
                is_error: false,
                content: "committed",
              },
            ],
          },
        },
      ];
      writeFileSync(
        s1Path,
        s1Lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      );

      // s2.jsonl: só git commit -> verification = 'none', commits = 1, excerpt = comando
      writeFileSync(
        join(sessDir, "s2.jsonl"),
        [
          {
            sessionId: "s2",
            cwd: "/tmp/x/proj",
            timestamp: "2026-10-24T11:00:00.000Z",
            type: "assistant",
            message: {
              model: "claude-opus-5-5",
              content: [
                {
                  type: "tool_use",
                  id: "c1",
                  name: "Bash",
                  input: { command: "git commit -m 'sem teste'" },
                },
              ],
            },
          },
          {
            sessionId: "s2",
            timestamp: "2026-10-24T11:00:05.000Z",
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "c1",
                  is_error: false,
                  content: "ok",
                },
              ],
            },
          },
        ]
          .map((l) => JSON.stringify(l))
          .join("\n") + "\n",
      );

      // s3.jsonl: bun test sem tool_result -> verification = 'not run'
      writeFileSync(
        join(sessDir, "s3.jsonl"),
        JSON.stringify({
          sessionId: "s3",
          cwd: "/tmp/x/proj",
          timestamp: "2026-10-24T11:10:00.000Z",
          type: "assistant",
          message: {
            model: "claude-opus-5-5",
            content: [
              {
                type: "tool_use",
                id: "t-orphan",
                name: "Bash",
                input: { command: "bun test" },
              },
            ],
          },
        }) + "\n",
      );

      // s4.jsonl: sem linha de uso -> os três tokens IS NULL
      writeFileSync(
        join(sessDir, "s4.jsonl"),
        JSON.stringify({
          sessionId: "s4",
          cwd: "/tmp/x/proj",
          timestamp: "2026-10-24T11:20:00.000Z",
          type: "user",
          message: { role: "user", content: "oi" },
        }) + "\n",
      );

      const r16 = runPinga(
        ["learn", "ingest", "--sessions", join(f.tmpdir, "sessions"), "--db", dbPath],
        f.env,
      );
      expect(r16.exit).toBe(0);

      const expectedS1Tokens = tokenFieldsFor(s1Path).tokens;
      db = openLearnDb(dbPath);
      try {
        const s1Row = db
          .query("SELECT * FROM session WHERE id = 'claude:s1'")
          .get() as Record<string, unknown>;
        expect(s1Row.rework_cycles).toBe(3);
        expect(s1Row.commits).toBe(1);
        expect(s1Row.verification).toBe("pass");
        expect(s1Row.model_family).toBe("claude");
        expect(s1Row.repo).toBe("proj");
        expect(s1Row.tokens_in).toBe(expectedS1Tokens.in);
        expect(s1Row.tokens_out).toBe(expectedS1Tokens.out);
        expect(s1Row.tokens_cache).toBe(expectedS1Tokens.cache);
        expect(String(s1Row.excerpt)).toContain("[REDACTED:anthropic]");
        expect(String(s1Row.excerpt).includes("sk-ant-")).toBe(false);

        const s2Row = db
          .query("SELECT * FROM session WHERE id = 'claude:s2'")
          .get() as Record<string, unknown>;
        expect(s2Row.verification).toBe("none");
        expect(s2Row.commits).toBe(1);
        expect(s2Row.excerpt).toBe("git commit -m 'sem teste'");

        const s3Row = db
          .query("SELECT * FROM session WHERE id = 'claude:s3'")
          .get() as Record<string, unknown>;
        expect(s3Row.verification).toBe("not run");

        const s4Row = db
          .query("SELECT * FROM session WHERE id = 'claude:s4'")
          .get() as Record<string, unknown>;
        expect(s4Row.tokens_in).toBeNull();
        expect(s4Row.tokens_out).toBeNull();
        expect(s4Row.tokens_cache).toBeNull();

        // 19. Nada vaza em nenhuma coluna TEXT de nenhuma linha
        const allRows = db.query("SELECT * FROM session").all() as Array<
          Record<string, unknown>
        >;
        for (const r of allRows) {
          for (const v of Object.values(r)) {
            if (typeof v === "string") {
              expect(redact(v).findings).toEqual([]);
            }
          }
        }
        const leakCheck = db
          .query(
            "SELECT count(*) as c FROM session WHERE excerpt LIKE '%FAKE%' OR verification_evidence LIKE '%FAKE%'",
          )
          .get() as { c: number };
        expect(leakCheck.c).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      cleanupFakeEnv(f);
    }
  });

  test("17, 18, 20. Canário falhou (exit 15), --db dentro de repo (exit 2) e CLI", () => {
    const f = makeRealisticHome();
    try {
      // 17. Canário falhou
      const canaryFile = join(f.tmpdir, "bad-canary.txt");
      const survivor = "hunter2" + "hunter2";
      writeFileSync(canaryFile, `${survivor}\n`);
      const db17 = join(f.tmpdir, "canary-fail.db");
      const dummyLedger = join(f.tmpdir, "l17.db");
      openLedger(dummyLedger).close();

      const r17 = runPinga(
        ["learn", "ingest", "--ledger", dummyLedger, "--db", db17],
        { ...f.env, PINGA_REDACT_CANARY: canaryFile },
      );
      expect(r17.exit).toBe(15);
      expect(r17.stderr).toContain("canário");
      expect(r17.stderr.includes("hun" + "ter2")).toBe(false);
      expect(existsSync(db17)).toBe(false);

      // 18. --db dentro de repo git não ignorado -> exit 2
      const gitDir = join(f.tmpdir, "git-repo");
      mkdirSync(gitDir, { recursive: true });
      Bun.spawnSync(["git", "init", "-q"], { cwd: gitDir });
      const dbInRepo = join(gitDir, "l.db");
      const r18a = runPinga(
        ["learn", "ingest", "--ledger", dummyLedger, "--db", dbInRepo],
        f.env,
      );
      expect(r18a.exit).toBe(2);
      expect(r18a.stderr).toContain("dentro de repo");
      expect(existsSync(dbInRepo)).toBe(false);

      // Com .gitignore *.db -> exit 0
      writeFileSync(join(gitDir, ".gitignore"), "*.db\n");
      const r18b = runPinga(
        ["learn", "ingest", "--ledger", dummyLedger, "--db", dbInRepo],
        f.env,
      );
      expect(r18b.exit).toBe(0);

      // 20. CLI
      expect(runPinga(["learn", "ingest"], f.env).exit).toBe(2);
      expect(runPinga(["learn", "ingest", "--db"], f.env).exit).toBe(2);
      expect(runPinga(["learn", "xpto"], f.env).exit).toBe(2);
      expect(runPinga(["learn", "scan"], f.env).exit).toBe(2);
      const usage = runPinga([], f.env);
      expect(usage.stdout + usage.stderr).toContain("pinga learn ingest");
      expect(usage.stdout + usage.stderr).toContain("pinga learn scan");
    } finally {
      cleanupFakeEnv(f);
    }
  });
});
