import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli";
import { openLedger } from "../src/ledger";
import {
  MAX_ENVELOPE_BYTES,
  buildMaestroEnvelope,
  computeWorkerScoreboard,
  createTaskRequest,
  formatMaestroDigest,
  recommendOrchestration,
  runHermesMaestroTurn,
  truncateEnvelopeString,
} from "../src/maestro";

describe("T20 — Plano A: Modo Maestro com Hermes e Meta-Aprendizado", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pinga-t20-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("1. createTaskRequest generates valid envelope with correct refs and hashes", () => {
    const planPath = join(tmp, "PLAN.md");
    writeFileSync(
      planPath,
      [
        "---",
        "mode: padrao",
        "goal: Tarefa de teste para o Maestro",
        "done_when: exit 0",
        "touch: [\"src/a.ts\"]",
        "---",
        "## Passos",
      ].join("\n"),
    );

    const req = createTaskRequest(planPath, {
      origin: "hermes",
      replyTo: "hermes:session-1",
    });
    expect(req.v).toBe(1);
    expect(req.type).toBe("task.request");
    expect(req.mode).toBe("padrao");
    expect(req.goal).toBe("Tarefa de teste para o Maestro");
    expect(req.origin).toBe("hermes");
    expect(req.reply_to).toBe("hermes:session-1");
    expect(req.contract_ref.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("2 & 3. truncateEnvelopeString and buildMaestroEnvelope respect MAX_ENVELOPE_BYTES (<= 4096)", () => {
    expect(MAX_ENVELOPE_BYTES).toBe(4096);
    expect(truncateEnvelopeString("hello", 10)).toBe("hello");
    expect(truncateEnvelopeString("abcdef", 3)).toBe("abc");

    const hugeSummary = "x".repeat(6000);
    const mockReceipt = {
      v: 1,
      type: "task.receipt",
      id: "rcpt-huge",
      task: "T99",
      status: "pass",
      reason_code: null,
      mode_effective: "padrao",
      attempts: 1,
      tokens: { in: 100, out: 50, source: "mock" },
      summary: hugeSummary,
    };

    const env = buildMaestroEnvelope(mockReceipt);
    expect(env.v).toBe(1);
    expect(env.type).toBe("maestro.receipt");
    expect(env.status).toBe("pass");

    const jsonStr = JSON.stringify(env);
    const byteLen = Buffer.byteLength(jsonStr, "utf8");
    expect(byteLen).toBeLessThanOrEqual(MAX_ENVELOPE_BYTES);
  });

  test("4, 5 & 6. computeWorkerScoreboard calculates FTPR, median tokens, unranked <2 tasks, breaker & holdouts", async () => {
    const ledgerPath = join(tmp, "test-ledger.db");
    const ledger = openLedger(ledgerPath);

    // Model A: 2 tasks, 1 pass attempt 1 (tokens 1000), 1 pass attempt 2 (tokens 2000) -> ranked, ftpr = 0.5, median = 1500
    ledger.record({
      task: "T01",
      status: "pass",
      reason_code: null,
      attempts: 1,
      evidence: [],
      tokens: { in: 1000, out: 100, cache: null, source: "mock" },
      cost_usd: null,
      cost_evidence: "not run",
      author: { model: "model-a", family: "fam-a" },
      verified_by: null,
      summary: "pass 1",
    });
    ledger.record({
      task: "T02",
      status: "pass",
      reason_code: null,
      attempts: 2,
      evidence: [],
      tokens: { in: 2000, out: 200, cache: null, source: "mock" },
      cost_usd: null,
      cost_evidence: "not run",
      author: { model: "model-a", family: "fam-a" },
      verified_by: null,
      summary: "pass 2",
    });

    // Model B: 1 task -> unranked
    ledger.record({
      task: "T03",
      status: "blocked",
      reason_code: "breaker_same_failure",
      attempts: 2,
      evidence: [],
      tokens: { in: 500, out: 50, cache: null, source: "mock" },
      cost_usd: null,
      cost_evidence: "not run",
      author: { model: "model-b", family: "fam-b" },
      verified_by: null,
      summary: "breaker tripped",
    });

    ledger.close();

    const scoreboard = await computeWorkerScoreboard(ledgerPath);
    expect(scoreboard.workers.length).toBe(2);

    const wA = scoreboard.workers.find((w) => w.model === "model-a");
    expect(wA).toBeDefined();
    expect(wA!.status).toBe("ranked");
    expect(wA!.total_tasks).toBe(2);
    expect(wA!.ftpr).toBe(0.5);
    expect(wA!.median_tokens_per_verified).toBe(1500);

    const wB = scoreboard.workers.find((w) => w.model === "model-b");
    expect(wB).toBeDefined();
    expect(wB!.status).toBe("unranked");
    expect(wB!.breaker_trips).toBe(1);
  });

  test("7, 8 & 9. recommendOrchestration chooses motor for mvp, maestro for completo, and best worker", () => {
    const planMvp = join(tmp, "PLAN-MVP.md");
    writeFileSync(
      planMvp,
      "---\nmode: mvp\ngoal: Quick spike\ndone_when: exit 0\n---\n",
    );

    const planCompleto = join(tmp, "PLAN-COMPLETO.md");
    writeFileSync(
      planCompleto,
      "---\nmode: completo\ngoal: Full refactor\ndone_when: exit 0\ntouch: [\"src/core.ts\"]\n---\n",
    );

    const scoreboard = {
      updated_at: new Date().toISOString(),
      workers: [
        {
          model: "cheap-fast",
          family: "fam",
          total_tasks: 5,
          ftpr: 0.8,
          median_tokens_per_verified: 2000,
          breaker_trips: 0,
          holdout_failures: 0,
          status: "ranked" as const,
        },
        {
          model: "expensive",
          family: "fam",
          total_tasks: 4,
          ftpr: 0.5,
          median_tokens_per_verified: 15000,
          breaker_trips: 1,
          holdout_failures: 0,
          status: "ranked" as const,
        },
      ],
    };

    const recMvp = recommendOrchestration(planMvp, scoreboard);
    expect(recMvp.topology).toBe("motor");
    expect(recMvp.recommended_worker).toBe("cheap-fast");

    const recCompleto = recommendOrchestration(planCompleto, scoreboard);
    expect(recCompleto.topology).toBe("maestro");
  });

  test("10. formatMaestroDigest produces clean markdown report", () => {
    const scoreboard = {
      updated_at: "2026-10-25T01:00:00Z",
      workers: [
        {
          model: "gemini-3.8-flash",
          family: "gemini",
          total_tasks: 3,
          ftpr: 1.0,
          median_tokens_per_verified: 5000,
          breaker_trips: 0,
          holdout_failures: 0,
          status: "ranked" as const,
        },
      ],
    };

    const digest = formatMaestroDigest(scoreboard, []);
    expect(digest).toContain("Maestro Digest");
    expect(digest).toContain("gemini-3.8-flash");
    expect(digest).toContain("FTPR: 100%");
  });

  test("11. runHermesMaestroTurn executes single ephemeral turn with usage-file", async () => {
    const stubScript = join(tmp, "fake-hermes.sh");
    writeFileSync(
      stubScript,
      [
        "#!/bin/sh",
        "echo '{\"usage\":{\"input\":350,\"output\":80}}' > \"$4\"",
        "echo 'Hermes turn output'",
      ].join("\n"),
    );
    Bun.spawnSync(["chmod", "+x", stubScript]);

    const res = await runHermesMaestroTurn("Hello Hermes", {
      hermesBin: stubScript,
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("Hermes turn output");
    expect(res.tokens_in).toBe(350);
    expect(res.tokens_out).toBe(80);
  });

  test("12, 13, 14 & 15. CLI pinga maestro subcommands (scoreboard, recommend, envelope, digest)", async () => {
    const planPath = join(tmp, "PLAN.md");
    writeFileSync(
      planPath,
      "---\nmode: padrao\ngoal: CLI maestro test\ndone_when: exit 0\ntouch: [\"src/m.ts\"]\n---\n",
    );

    const exit1 = await runCli(["maestro", "scoreboard", "--json"]);
    expect(exit1).toBe(0);

    const exit2 = await runCli(["maestro", "recommend", planPath, "--json"]);
    expect(exit2).toBe(0);

    const exit3 = await runCli(["maestro", "envelope", planPath]);
    expect(exit3).toBe(0);

    const exit4 = await runCli(["maestro", "digest"]);
    expect(exit4).toBe(0);
  });
});
