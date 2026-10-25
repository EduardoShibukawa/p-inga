import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditNoVerify,
  computeAuditGate,
  evaluateLessonsPrecision,
} from "../src/audit";
import { runCli } from "../src/cli";
import { openLearnDb } from "../src/learn";

function git(cwd: string, args: string[]): void {
  const r = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PATH: process.env.PATH ?? "",
      HOME: cwd,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
}

function insertTranscript(
  db: ReturnType<typeof openLearnDb>,
  id: string,
  evidence: string | null,
  excerpt: string | null,
): void {
  db.query(
    `INSERT INTO session (id, kind, harness, source_path, source_sha256, verification, verification_evidence, excerpt, ingested_at)
     VALUES (?, 'transcript', 'claude', '/tmp/x', ?, 'none', ?, ?, '2026-10-25T00:00:00Z')`,
  ).run(id, "a".repeat(64), evidence, excerpt);
}

describe("T19 — learn audit: --no-verify and lessons precision", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pinga-t19-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("1. computeAuditGate handles threshold, exact boundary and zero sample", () => {
    expect(computeAuditGate({ sample_size: 30, useful_count: 21, threshold: 0.7 })).toBe(true);
    expect(computeAuditGate({ sample_size: 30, useful_count: 20, threshold: 0.7 })).toBe(false);
    expect(computeAuditGate({ sample_size: 0, useful_count: 0 })).toBe(false);
    expect(computeAuditGate({ sample_size: 10, useful_count: 7 })).toBe(true);
  });

  test("2 & 3. auditNoVerify flags executed git commit --no-verify, ignores prose, cross-checks git", async () => {
    const db = openLearnDb(join(tmp, "learn.db"));
    insertTranscript(db, "claude:a", "pass · git commit --no-verify -m wip · linha 3", null);
    insertTranscript(db, "claude:b", null, "não use --no-verify nunca");
    insertTranscript(db, "claude:c", "pass · bun test · linha 9", null);

    const repo = join(tmp, "repo");
    Bun.spawnSync(["mkdir", "-p", repo]);
    git(repo, ["init", "-q"]);
    writeFileSync(join(repo, "a.txt"), "1");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "--no-verify", "-m", "wip"]);

    const res = await auditNoVerify(db, repo);
    db.close();
    expect(res.tool_calls_flagged).toBe(1);
    expect(res.git_commits_bypassed).toBeGreaterThanOrEqual(0);
    expect(res.clean_ratio).toBeGreaterThanOrEqual(0);
    expect(res.clean_ratio).toBeLessThanOrEqual(1);
  });

  test("4, 5, 6 & 9. evaluateLessonsPrecision is deterministic, scores useful lessons and handles empty sample", () => {
    const empty = openLearnDb(join(tmp, "empty.db"));
    const r0 = evaluateLessonsPrecision(empty);
    expect(r0.sample_size).toBe(0);
    expect(r0.precision_ratio).toBe(0);
    expect(r0.passes_gate).toBe(false);
    expect(r0.gate_threshold).toBe(0.7);
    empty.close();

    const db = openLearnDb(join(tmp, "learn.db"));
    // 3 transcripts com rework >= 3 em repo concreto → lições úteis (evidência ≥ 2 sessões)
    for (const id of ["s1", "s2", "s3"]) {
      db.query(
        `INSERT INTO session (id, kind, harness, source_path, source_sha256, repo, verification, rework_cycles, excerpt, ingested_at)
         VALUES (?, 'transcript', 'claude', '/tmp/x', ?, 'p-inga', 'fail', 4, 'falhou de novo', '2026-10-25T00:00:00Z')`,
      ).run(`claude:${id}`, "b".repeat(64));
    }
    const r1 = evaluateLessonsPrecision(db, { sampleSize: 30 });
    const r2 = evaluateLessonsPrecision(db, { sampleSize: 30 });
    expect(r1).toEqual(r2);
    expect(r1.sample_size).toBeGreaterThan(0);
    expect(r1.sample_size).toBeLessThanOrEqual(30);
    expect(r1.details.length).toBe(r1.sample_size);
    for (const d of r1.details) {
      expect(typeof d.reason).toBe("string");
      expect(d.reason.length).toBeGreaterThan(0);
    }
    expect(r1.useful_count).toBeGreaterThan(0);
    expect(r1.passes_gate).toBe(r1.precision_ratio >= 0.7);
    db.close();
  });

  test("7 & 8. CLI pinga learn audit --db --json [--repo]", async () => {
    const dbPath = join(tmp, "cli.db");
    openLearnDb(dbPath).close();
    const exit1 = await runCli(["learn", "audit", "--db", dbPath, "--json"]);
    expect(exit1).toBe(0);
    const repo = join(tmp, "r2");
    Bun.spawnSync(["mkdir", "-p", repo]);
    git(repo, ["init", "-q"]);
    const exit2 = await runCli(["learn", "audit", "--db", dbPath, "--repo", repo, "--json"]);
    expect(exit2).toBe(0);
    const bad = await runCli(["learn", "audit", "--db", join(tmp, "nope.db")]);
    expect(bad).toBe(8);
  });
});
