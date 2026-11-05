import { describe, expect, test } from "bun:test";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { candidateId } from "../src/detect";
import { openLearnDb } from "../src/learn";
import { renderProposals } from "../src/lessons";
import { makeRealisticHome, runPinga } from "./helpers/home";

const EXPECTED_NOTICE =
  "aviso: lições migraram para o ginga (ginga lessons import / ginga learning promote)";

async function migrationNotice(): Promise<string> {
  const modulePath = join(import.meta.dir, "../src/lessons_migrado.ts");
  if (!existsSync(modulePath)) return EXPECTED_NOTICE;
  const module = await import(modulePath);
  return module.MIGRATION_NOTICE;
}

function cleanupFakeEnv(f: ReturnType<typeof makeRealisticHome>): void {
  rmSync(f.home, { recursive: true, force: true });
  rmSync(f.state, { recursive: true, force: true });
  rmSync(f.tmpdir, { recursive: true, force: true });
  rmSync(f.source, { recursive: true, force: true });
}

describe("T81 — pinga learn avisa a migração para o ginga", () => {
  test("propose e promote avisam no stderr sem mudar stdout nem exit", async () => {
    const notice = await migrationNotice();
    expect(notice).toBe(EXPECTED_NOTICE);

    const f = makeRealisticHome();
    try {
      const dbPath = join(f.state, "pinga/learn.db");
      const db = openLearnDb(dbPath);
      db.close();
      const proposalsPath = join(f.tmpdir, "LESSONS-PROPOSED.md");

      const propose = runPinga(
        ["learn", "propose", "--db", dbPath, "--out", proposalsPath],
        f.env,
      );
      expect(propose.exit).toBe(0);
      expect(propose.stdout).toBe(
        `proposed 0 discarded 0 → ${proposalsPath}\n`,
      );
      expect(
        propose.stderr.split(/\r?\n/).filter((line) => line === notice),
      ).toHaveLength(1);

      const id = candidateId("rework", "claude:s1");
      writeFileSync(
        proposalsPath,
        renderProposals([
          {
            candidate: {
              id,
              detector: "rework",
              class: "ruim",
              session_id: "claude:s1",
              harness: "claude",
              repo: "p-inga",
              task: "T01",
              model: "claude-opus-5-5",
              model_family: "claude",
              metric: "rework_cycles",
              value: 3,
              baseline: "0",
              excerpt: "rework 3x",
              action: "Dividir o passo em subpassos verificáveis",
              destination: "p-inga/LESSONS.md",
            },
            verdict: null,
          },
        ]),
      );
      const lessonsPath = join(f.tmpdir, "LESSONS.md");
      const promote = runPinga(
        [
          "learn",
          "promote",
          proposalsPath,
          "--id",
          id,
          "--to",
          lessonsPath,
        ],
        { ...f.env, USER: "dono-teste" },
      );
      expect(promote.exit).toBe(0);
      expect(promote.stdout).toBe("");
      expect(
        promote.stderr.split(/\r?\n/).filter((line) => line === notice),
      ).toHaveLength(1);
    } finally {
      cleanupFakeEnv(f);
    }
  });
});
