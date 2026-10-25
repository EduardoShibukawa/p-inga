import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type Candidate,
  DETECTORS,
  type Detector,
  REWORK_MIN,
  candidateId,
  detect,
  validateCandidate,
} from "../src/detect";
import { openLearnDb } from "../src/learn";
import {
  LESSON_JUDGE_PROMPT_VERSION,
  PROPOSALS_HEADER,
  type Verdict,
  defaultProposalsPath,
  parseProposals,
  promoteCmd,
  proposeCmd,
  renderProposals,
} from "../src/lessons";
import { redact } from "../src/redact";
import { NOW, makeRealisticHome, runPinga, tmp } from "./helpers/home";

const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function cleanupFakeEnv(f: ReturnType<typeof makeRealisticHome>) {
  rmSync(f.home, { recursive: true, force: true });
  rmSync(f.state, { recursive: true, force: true });
  rmSync(f.tmpdir, { recursive: true, force: true });
  rmSync(f.source, { recursive: true, force: true });
}

async function runPingaAsync(
  args: string[],
  env: Record<string, string>,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const realTmp = realpathSync(tmpdir());
  for (const key of ["HOME", "XDG_STATE_HOME", "TMPDIR"] as const) {
    const val = env[key];
    if (!val || !val.startsWith(realTmp)) {
      throw new Error(`I16 violation: ${key}=${String(val)}`);
    }
  }
  const childEnv: Record<string, string> = { ...env };
  delete childEnv.XDG_CONFIG_HOME;
  delete childEnv.XDG_DATA_HOME;
  delete childEnv.PI_CODING_AGENT_DIR;

  const proc = Bun.spawn([process.execPath, BIN, ...args], {
    cwd: ROOT,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exit, stdout, stderr };
}

function insertSessionRow(
  db: import("bun:sqlite").Database,
  overrides: Record<string, unknown> & { id: string; kind: string },
) {
  const row: Record<string, unknown> = {
    id: overrides.id,
    kind: overrides.kind,
    harness: overrides.harness ?? (overrides.kind === "transcript" ? "claude" : "pinga"),
    source_path: overrides.source_path ?? "/tmp/src",
    source_sha256: overrides.source_sha256 ?? "a".repeat(64),
    repo: "repo" in overrides ? overrides.repo : "p-inga",
    task: "task" in overrides ? overrides.task : "T01",
    started_at: overrides.started_at ?? "2026-10-24T10:00:00.000Z",
    ended_at: overrides.ended_at ?? "2026-10-24T10:05:00.000Z",
    model: "model" in overrides ? overrides.model : "glm-5.3-flash",
    model_family: "model_family" in overrides ? overrides.model_family : "glm",
    tokens_in: overrides.tokens_in ?? null,
    tokens_out: overrides.tokens_out ?? null,
    tokens_cache: overrides.tokens_cache ?? null,
    verification: overrides.verification ?? "pass",
    verification_evidence: overrides.verification_evidence ?? null,
    receipt_kind:
      "receipt_kind" in overrides
        ? overrides.receipt_kind
        : overrides.kind === "receipt"
          ? "verify"
          : null,
    status: overrides.status ?? null,
    reason_code: overrides.reason_code ?? null,
    attempts: overrides.attempts ?? null,
    rework_cycles: overrides.rework_cycles ?? null,
    commits: overrides.commits ?? null,
    excerpt: "excerpt" in overrides ? overrides.excerpt : "trecho de exemplo",
    ingested_at: overrides.ingested_at ?? NOW,
  };

  const cols = Object.keys(row);
  const placeholders = cols.map(() => "?").join(", ");
  db.query(
    `INSERT INTO session (${cols.join(", ")}) VALUES (${placeholders})`,
  ).run(...(cols.map((c) => row[c]) as Array<string | number | null>));
}

describe("T15 — Detectores determinísticos e LESSONS-PROPOSED.md (I20) — Unitários", () => {
  test("1 & 2. candidateId e validateCandidate", () => {
    expect(DETECTORS).toEqual([
      "rework",
      "missing_verification",
      "breaker_tripped",
      "overfit_holdout",
      "guard_violation",
    ]);
    expect(REWORK_MIN).toBe(3);
    expect(PROPOSALS_HEADER).toBe("# LESSONS-PROPOSED — pinga learn propose v1");
    expect(LESSON_JUDGE_PROMPT_VERSION).toBe(1);

    const id1 = candidateId("rework", "claude:s1");
    expect(id1).toMatch(/^L-[0-9a-f]{12}$/);
    expect(candidateId("rework", "claude:s1")).toBe(id1);
    expect(candidateId("missing_verification", "claude:s1")).not.toBe(id1);
    expect(candidateId("rework", "claude:s2")).not.toBe(id1);

    const valid: Candidate = {
      id: id1,
      detector: "rework",
      class: "ruim",
      session_id: "claude:s1",
      harness: "claude",
      repo: "p-inga",
      task: null,
      model: "claude-opus-5-5",
      model_family: "claude",
      metric: "rework_cycles",
      value: 3,
      baseline: ">= 3",
      excerpt: "falhou 3x antes de passar",
      action: "Dividir passo ou revisar contrato RED antes de editar em loop",
      destination: "p-inga/LESSONS.md",
    };

    expect(validateCandidate(valid).ok).toBe(true);

    // Inválidos
    expect(validateCandidate({ ...valid, session_id: "" }).ok).toBe(false);
    expect(validateCandidate({ ...valid, excerpt: "" }).ok).toBe(false);
    expect(validateCandidate({ ...valid, excerpt: "x".repeat(301) }).ok).toBe(
      false,
    );
    expect(validateCandidate({ ...valid, metric: "" }).ok).toBe(false);
    expect(
      validateCandidate({ ...valid, detector: "x" as Detector }).ok,
    ).toBe(false);
    expect(validateCandidate({ ...valid, value: -1 }).ok).toBe(false);
    expect(validateCandidate({ ...valid, foo: 1 }).ok).toBe(false);
    expect(validateCandidate({ ...valid, id: "L-000000000000" }).ok).toBe(
      false,
    );
    const noExcerpt = { ...valid } as Record<string, unknown>;
    delete noExcerpt.excerpt;
    expect(validateCandidate(noExcerpt).ok).toBe(false);
  });

  test("3, 4, 5, 7. Regras dos 5 detectores, determinismo, destino e redação em profundidade", () => {
    const d = tmp("pinga-t15-det-");
    try {
      // 3a. rework: 3 -> 1 candidato; 2 -> nenhum
      const dbRework = openLearnDb(join(d, "rework.db"));
      insertSessionRow(dbRework, {
        id: "claude:s1",
        kind: "transcript",
        rework_cycles: 3,
        verification: "pass",
      });
      insertSessionRow(dbRework, {
        id: "claude:s2",
        kind: "transcript",
        rework_cycles: 2,
        verification: "pass",
      });
      const resRework = detect(dbRework);
      expect(resRework.candidates.length).toBe(1);
      expect(resRework.candidates[0]!.detector).toBe("rework");
      expect(resRework.candidates[0]!.value).toBe(3);
      expect(resRework.candidates[0]!.baseline).toBe(">= 3");
      expect(resRework.candidates[0]!.class).toBe("ruim");
      dbRework.close();

      // 3b. missing_verification
      const dbMv = openLearnDb(join(d, "mv.db"));
      insertSessionRow(dbMv, {
        id: "claude:m1",
        kind: "transcript",
        commits: 1,
        verification: "none",
      });
      insertSessionRow(dbMv, {
        id: "claude:m2",
        kind: "transcript",
        commits: 0,
        verification: "none",
      });
      insertSessionRow(dbMv, {
        id: "claude:m3",
        kind: "transcript",
        commits: 2,
        verification: "pass",
      });
      const resMv = detect(dbMv);
      expect(resMv.candidates.length).toBe(1);
      expect(resMv.candidates[0]!.session_id).toBe("claude:m1");
      expect(resMv.candidates[0]!.detector).toBe("missing_verification");
      dbMv.close();

      // 3c. breaker_tripped: 2 recibos da task T05 -> 1 candidato value: 2, menor started_at, class: melhorar
      const dbBr = openLearnDb(join(d, "br.db"));
      insertSessionRow(dbBr, {
        id: "receipt:b2",
        kind: "receipt",
        task: "T05",
        started_at: "2026-10-24T10:05:00.000Z",
        status: "blocked",
        reason_code: "breaker_same_failure",
      });
      insertSessionRow(dbBr, {
        id: "receipt:b1",
        kind: "receipt",
        task: "T05",
        started_at: "2026-10-24T10:01:00.000Z",
        status: "blocked",
        reason_code: "breaker_same_failure",
      });
      const resBr = detect(dbBr);
      expect(resBr.candidates.length).toBe(1);
      expect(resBr.candidates[0]!.value).toBe(2);
      expect(resBr.candidates[0]!.session_id).toBe("receipt:b1");
      expect(resBr.candidates[0]!.class).toBe("melhorar");
      dbBr.close();

      // 3d & 3e & negativos & excerpt nulo
      const dbMix = openLearnDb(join(d, "mix.db"));
      insertSessionRow(dbMix, {
        id: "receipt:ov1",
        kind: "receipt",
        task: "T10",
        status: "fail",
        reason_code: "overfit_holdout",
        repo: "pi-harness@fix-0047",
      });
      insertSessionRow(dbMix, {
        id: "receipt:gv1",
        kind: "receipt",
        task: "T04",
        started_at: "2026-10-24T10:01:00.000Z",
        status: "blocked",
        reason_code: "tests_frozen_changed",
        repo: null,
      });
      insertSessionRow(dbMix, {
        id: "receipt:gv2",
        kind: "receipt",
        task: "T04",
        started_at: "2026-10-24T10:02:00.000Z",
        status: "blocked",
        reason_code: "scope_drift",
        repo: null,
      });
      // Negativos: same_family_judge, command_failed
      insertSessionRow(dbMix, {
        id: "receipt:sf",
        kind: "receipt",
        task: "T08",
        status: "blocked",
        reason_code: "same_family_judge",
      });
      insertSessionRow(dbMix, {
        id: "receipt:cf",
        kind: "receipt",
        task: "T03",
        status: "fail",
        reason_code: "command_failed",
      });
      // Excerpt nulo -> discarded: 1
      insertSessionRow(dbMix, {
        id: "claude:null-ex",
        kind: "transcript",
        rework_cycles: 4,
        excerpt: null,
      });

      const resMix = detect(dbMix);
      expect(resMix.discarded).toBe(1);
      expect(resMix.candidates.length).toBe(2);
      const ov = resMix.candidates.find((c) => c.detector === "overfit_holdout")!;
      const gv = resMix.candidates.find((c) => c.detector === "guard_violation")!;
      expect(ov.class).toBe("ruim");
      // 5. Destino
      expect(ov.destination).toBe("pi-harness/LESSONS.md");
      expect(gv.value).toBe(2);
      expect(gv.destination).toBe("LESSONS.md (raiz)");
      dbMix.close();

      // 4. Determinismo: mesma coleção inserida em duas ordens diferentes -> detect e renderProposals idênticos
      const rowsOrder = [
        {
          id: "receipt:g1",
          kind: "receipt",
          task: "T04",
          reason_code: "scope_drift",
        },
        {
          id: "claude:r1",
          kind: "transcript",
          rework_cycles: 3,
        },
        {
          id: "receipt:o1",
          kind: "receipt",
          task: "T10",
          reason_code: "overfit_holdout",
        },
      ];
      const dbO1 = openLearnDb(join(d, "o1.db"));
      const dbO2 = openLearnDb(join(d, "o2.db"));
      for (const r of rowsOrder) insertSessionRow(dbO1, r);
      for (const r of [...rowsOrder].reverse()) insertSessionRow(dbO2, r);
      const d1 = detect(dbO1);
      const d2 = detect(dbO2);
      expect(d1).toEqual(d2);
      expect(d1.candidates.map((c) => c.detector)).toEqual([
        "rework",
        "overfit_holdout",
        "guard_violation",
      ]);
      expect(
        renderProposals(d1.candidates.map((candidate) => ({ candidate, verdict: null }))),
      ).toBe(
        renderProposals(d2.candidates.map((candidate) => ({ candidate, verdict: null }))),
      );
      dbO1.close();
      dbO2.close();

      // 7. Redação em profundidade: linha inserida direto no banco com token github
      const gh = "ghp_" + "FAKE".repeat(9);
      const dbRed = openLearnDb(join(d, "red.db"));
      insertSessionRow(dbRed, {
        id: "claude:leak",
        kind: "transcript",
        rework_cycles: 3,
        excerpt: `erro com token ${gh} aqui`,
      });
      const dRed = detect(dbRed);
      expect(dRed.candidates[0]!.excerpt).toContain("[REDACTED:github]");
      expect(dRed.candidates[0]!.excerpt.includes("ghp_")).toBe(false);
      const renderedRed = renderProposals(
        dRed.candidates.map((candidate) => ({ candidate, verdict: null })),
      );
      expect(renderedRed.includes("ghp_")).toBe(false);
      dbRed.close();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("6. Round-trip parseProposals(renderProposals(items))", () => {
    const c1: Candidate = {
      id: candidateId("rework", "claude:s1"),
      detector: "rework",
      class: "ruim",
      session_id: "claude:s1",
      harness: "claude",
      repo: "p-inga",
      task: null,
      model: "claude-opus-5-5",
      model_family: "claude",
      metric: "rework_cycles",
      value: 3,
      baseline: ">= 3",
      excerpt: 'aspas " barra \\ e ponto · aqui',
      action: "Ação 1",
      destination: "p-inga/LESSONS.md",
    };
    const c2: Candidate = {
      ...c1,
      id: candidateId("breaker_tripped", "receipt:b1"),
      detector: "breaker_tripped",
      class: "melhorar",
      session_id: "receipt:b1",
      harness: "pinga",
      repo: null,
      task: "T05",
      model: null,
      model_family: null,
      metric: "breaker_trips",
      value: 2,
      baseline: "0",
    };
    const c3: Candidate = {
      ...c1,
      id: candidateId("overfit_holdout", "receipt:o1"),
      detector: "overfit_holdout",
      session_id: "receipt:o1",
      task: "T10",
    };

    const items: Array<{ candidate: Candidate; verdict: Verdict | null }> = [
      { candidate: c1, verdict: null },
      {
        candidate: c2,
        verdict: {
          verdict: "pass",
          findings: [],
          served: "qwen3.5-4b",
          family: "qwen",
        },
      },
      {
        candidate: c3,
        verdict: {
          verdict: "fail",
          findings: ["achado 1", "achado 2"],
          served: "qwen3.5-4b",
          family: "qwen",
        },
      },
    ];

    const md = renderProposals(items);
    const parsed = parseProposals(md);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.items).toEqual(items);
    }

    // Lista vazia -> _nenhum candidato_ e volta []
    const emptyMd = renderProposals([]);
    expect(emptyMd).toContain("_nenhum candidato_");
    const parsedEmpty = parseProposals(emptyMd);
    expect(parsedEmpty).toEqual({ ok: true, items: [] });

    // Texto malformado -> ok: false
    expect(
      parseProposals(`${PROPOSALS_HEADER}\n\n## L-000000000000 · rework · ruim\n`).ok,
    ).toBe(false);
  });
});

describe("T15 — CLI learn propose e learn promote (I10 / I20)", () => {
  function seedReferenceDb(dbPath: string) {
    const db = openLearnDb(dbPath);
    insertSessionRow(db, {
      id: "claude:s1",
      kind: "transcript",
      rework_cycles: 3,
      model: "claude-opus-5-5",
      model_family: "claude",
      excerpt: "rework 3x",
    });
    insertSessionRow(db, {
      id: "claude:s2",
      kind: "transcript",
      commits: 1,
      verification: "none",
      model: "gemini-4-argon",
      model_family: "gemini",
      excerpt: "commit sem teste",
    });
    insertSessionRow(db, {
      id: "receipt:b1",
      kind: "receipt",
      task: "T05",
      reason_code: "breaker_same_failure",
      model: "glm-5.3-flash",
      model_family: "glm",
      excerpt: "disjuntor armado",
    });
    insertSessionRow(db, {
      id: "receipt:o1",
      kind: "receipt",
      task: "T10",
      reason_code: "overfit_holdout",
      model: "glm-5.3-flash",
      model_family: "glm",
      excerpt: "overfit holdout",
    });
    insertSessionRow(db, {
      id: "receipt:g1",
      kind: "receipt",
      task: "T04",
      reason_code: "scope_drift",
      model: "glm-5.3-flash",
      model_family: "glm",
      excerpt: "fora do touch",
    });
    // Excerpt nulo -> descartado
    insertSessionRow(db, {
      id: "claude:s-null",
      kind: "transcript",
      rework_cycles: 5,
      excerpt: null,
    });
    db.close();
  }

  test("8, 9, 14, 15, 16, 17, 18. Propose sem juiz, com juiz distinto, juiz só por flag, promote e CLI", async () => {
    const f = makeRealisticHome();
    let chatCalls = 0;
    const chatPrompts: string[] = [];
    const overfitId = candidateId("overfit_holdout", "receipt:o1");

    const srv = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "qwen3.5-4b" }] });
        }
        if (u.pathname === "/v1/chat/completions") {
          chatCalls++;
          const body = (await req.json()) as {
            model: string;
            messages: Array<{ role: string; content: string }>;
          };
          expect(body.model).toBe("qwen3.5-4b");
          const userMsg = body.messages.find((m) => m.role === "user")!.content;
          chatPrompts.push(userMsg);
          if (userMsg.includes(overfitId)) {
            return Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      verdict: "fail",
                      findings: ["sem evidência de repetição"],
                    }),
                  },
                },
              ],
            });
          }
          return Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({ verdict: "pass", findings: [] }),
                },
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const endpoint = `http://127.0.0.1:${srv.port}`;

    try {
      const dbPath = join(f.state, "pinga/learn.db");
      seedReferenceDb(dbPath);

      // 8. Sem juiz (com --out e sem --out)
      const out8 = join(f.tmpdir, "prop-no-judge.md");
      const r8 = runPinga(
        ["learn", "propose", "--db", dbPath, "--out", out8],
        f.env,
      );
      expect(r8.exit).toBe(0);
      expect(r8.stdout.trim()).toBe(`proposed 5 discarded 1 → ${out8}`);
      const md8 = readFileSync(out8, "utf8");
      expect(redact(md8).findings).toEqual([]);
      const parsed8 = parseProposals(md8);
      expect(parsed8.ok).toBe(true);
      if (parsed8.ok) {
        expect(parsed8.items.length).toBe(5);
        expect(parsed8.items.every((i) => i.verdict === null)).toBe(true);
      }

      // Sem --out -> defaultProposalsPath
      const r8Def = runPinga(["learn", "propose", "--db", dbPath], f.env);
      expect(r8Def.exit).toBe(0);
      expect(existsSync(defaultProposalsPath(f.env))).toBe(true);

      // 14. Juiz só por flag: PINGA_JUDGE_MODEL e PINGA_JUDGE_ENDPOINT no env sem flags -> 0 chamadas
      chatCalls = 0;
      const out14 = join(f.tmpdir, "prop-env-only.md");
      const r14 = await runPingaAsync(
        ["learn", "propose", "--db", dbPath, "--out", out14],
        {
          ...f.env,
          PINGA_JUDGE_MODEL: "qwen3.5-4b",
          PINGA_JUDGE_ENDPOINT: endpoint,
        },
      );
      expect(r14.exit).toBe(0);
      expect(chatCalls).toBe(0);

      // 9. Juiz distinto
      chatCalls = 0;
      chatPrompts.length = 0;
      const out9 = join(f.tmpdir, "prop-judged.md");
      const r9 = await runPingaAsync(
        [
          "learn",
          "propose",
          "--db",
          dbPath,
          "--out",
          out9,
          "--judge-endpoint",
          endpoint,
        ],
        f.env,
      );
      expect(r9.exit).toBe(0);
      expect(chatCalls).toBe(5);
      const md9 = readFileSync(out9, "utf8");
      const parsed9 = parseProposals(md9);
      expect(parsed9.ok).toBe(true);
      if (parsed9.ok) {
        expect(parsed9.items.length).toBe(5);
        const passed = parsed9.items.filter(
          (i) => i.verdict?.verdict === "pass",
        );
        const failed = parsed9.items.filter(
          (i) => i.verdict?.verdict === "fail",
        );
        expect(passed.length).toBe(4);
        expect(failed.length).toBe(1);
        expect(failed[0]!.candidate.id).toBe(overfitId);
        expect(failed[0]!.verdict?.findings).toEqual([
          "sem evidência de repetição",
        ]);
      }

      // 15. --db inexistente -> exit 8
      const out15 = join(f.tmpdir, "nao-criado.md");
      const r15 = runPinga(
        [
          "learn",
          "propose",
          "--db",
          join(f.tmpdir, "missing.db"),
          "--out",
          out15,
        ],
        f.env,
      );
      expect(r15.exit).toBe(8);
      expect(existsSync(out15)).toBe(false);

      // 16 & 17. CLI promote
      const approvedId = candidateId("rework", "claude:s1");
      const lessonsTarget = join(f.tmpdir, "LESSONS.md");
      const envPromote = { ...f.env, USER: "dono-teste" };

      const p16 = runPinga(
        [
          "learn",
          "promote",
          out9,
          "--id",
          approvedId,
          "--to",
          lessonsTarget,
        ],
        envPromote,
      );
      expect(p16.exit).toBe(0);
      const lessonsText = readFileSync(lessonsTarget, "utf8");
      expect(lessonsText).toContain(`pinga promote ${approvedId}`);
      expect(lessonsText).toContain(`proposta sha256:${sha256hex(md9)}`);
      expect(lessonsText).toContain("por dono-teste");
      expect(lessonsText).toContain(NOW);
      expect(lessonsText.includes("rework 3x")).toBe(false);

      const promoPath = join(f.state, "pinga/promotions.jsonl");
      const promoLines = readFileSync(promoPath, "utf8").trim().split("\n");
      expect(promoLines.length).toBe(1);
      const promoObj = JSON.parse(promoLines[0]!);
      expect(Object.keys(promoObj).sort()).toEqual([
        "at",
        "by",
        "detector",
        "id",
        "proposal_sha256",
        "session_id",
        "to",
      ]);

      // Repetir -> exit 1, 'já promovida'
      const p16Dup = runPinga(
        [
          "learn",
          "promote",
          out9,
          "--id",
          approvedId,
          "--to",
          lessonsTarget,
        ],
        envPromote,
      );
      expect(p16Dup.exit).toBe(1);
      expect(p16Dup.stderr).toContain("já promovida");
      expect(readFileSync(lessonsTarget, "utf8")).toBe(lessonsText);
      expect(readFileSync(promoPath, "utf8").trim().split("\n").length).toBe(1);

      // 17. Rejeitada pelo juiz -> exit 1
      const lessonsRej = join(f.tmpdir, "LESSONS-rej.md");
      const p17a = runPinga(
        ["learn", "promote", out9, "--id", overfitId, "--to", lessonsRej],
        envPromote,
      );
      expect(p17a.exit).toBe(1);
      expect(p17a.stderr).toContain("rejeitada pelo juiz");
      expect(existsSync(lessonsRej)).toBe(false);

      // ID inexistente -> exit 2
      expect(
        runPinga(
          [
            "learn",
            "promote",
            out9,
            "--id",
            "L-000000000000",
            "--to",
            lessonsRej,
          ],
          envPromote,
        ).exit,
      ).toBe(2);

      // Item não julgado (out8) -> exit 0
      const lessonsUnjudged = join(f.tmpdir, "LESSONS-unj.md");
      expect(
        runPinga(
          [
            "learn",
            "promote",
            out8,
            "--id",
            approvedId,
            "--to",
            lessonsUnjudged,
          ],
          envPromote,
        ).exit,
      ).toBe(0);

      // --by "" -> exit 2
      expect(
        runPinga(
          [
            "learn",
            "promote",
            out8,
            "--id",
            approvedId,
            "--to",
            lessonsUnjudged,
            "--by",
            "",
          ],
          envPromote,
        ).exit,
      ).toBe(2);

      // 18. CLI erros e USAGE
      expect(runPinga(["learn", "propose", "--xpto"], f.env).exit).toBe(2);
      expect(
        runPinga(["learn", "propose", "--judge-endpoint"], f.env).exit,
      ).toBe(2);
      expect(
        runPinga(["learn", "promote", out9, "--to", lessonsRej], f.env).exit,
      ).toBe(2);
      expect(
        runPinga(["learn", "promote", out9, "--id", approvedId], f.env).exit,
      ).toBe(2);
      const usage = runPinga([], f.env);
      expect(usage.stdout + usage.stderr).toContain("pinga learn propose");
      expect(usage.stdout + usage.stderr).toContain("pinga learn promote");
    } finally {
      srv.stop(true);
      cleanupFakeEnv(f);
    }
  });

  test("10, 11, 12, 13. Aborto I10 (same_family_judge exit 7, model_unattested exit 8), atestado inválido e falha no meio do chat", async () => {
    const f = makeRealisticHome();
    let chatCalls = 0;
    let mode: "ok" | "two_models" | "fail_2nd" | "no_json" = "ok";

    const srv = Bun.serve({
      port: 0,
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/v1/models") {
          if (mode === "two_models") {
            return Response.json({ data: [{ id: "m1" }, { id: "m2" }] });
          }
          return Response.json({ data: [{ id: "qwen3.5-4b" }] });
        }
        if (u.pathname === "/v1/chat/completions") {
          chatCalls++;
          if (mode === "fail_2nd" && chatCalls === 2) {
            return new Response("erro", { status: 500 });
          }
          if (mode === "no_json") {
            return Response.json({
              choices: [{ message: { content: "não sei" } }],
            });
          }
          return Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({ verdict: "pass", findings: [] }),
                },
              },
            ],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const endpoint = `http://127.0.0.1:${srv.port}`;

    try {
      // 10. Mesma família (I10) -> exit 7, 0 chamadas ao chat, --out intacto
      const db10Path = join(f.tmpdir, "db10.db");
      seedReferenceDb(db10Path);
      const db10 = openLearnDb(db10Path);
      insertSessionRow(db10, {
        id: "claude:qwen-sess",
        kind: "transcript",
        rework_cycles: 4,
        model: "qwen3.8-flash",
        model_family: "qwen",
        excerpt: "feito por qwen",
      });
      db10.close();
      const qwenCandId = candidateId("rework", "claude:qwen-sess");

      chatCalls = 0;
      const out10New = join(f.tmpdir, "out10-new.md");
      const r10a = await runPingaAsync(
        [
          "learn",
          "propose",
          "--db",
          db10Path,
          "--out",
          out10New,
          "--judge-endpoint",
          endpoint,
        ],
        f.env,
      );
      expect(r10a.exit).toBe(7);
      expect(r10a.stderr).toContain("same_family_judge");
      expect(r10a.stderr).toContain(qwenCandId);
      expect(chatCalls).toBe(0);
      expect(existsSync(out10New)).toBe(false);

      const out10Exist = join(f.tmpdir, "out10-exist.md");
      writeFileSync(out10Exist, "bytes originais\n");
      const r10b = await runPingaAsync(
        [
          "learn",
          "propose",
          "--db",
          db10Path,
          "--out",
          out10Exist,
          "--judge-endpoint",
          endpoint,
        ],
        f.env,
      );
      expect(r10b.exit).toBe(7);
      expect(readFileSync(out10Exist, "utf8")).toBe("bytes originais\n");

      // 11. Não atestado -> exit 8, 0 chamadas; com os dois problemas -> exit 7 (precedência)
      const db11Path = join(f.tmpdir, "db11.db");
      seedReferenceDb(db11Path);
      const db11 = openLearnDb(db11Path);
      insertSessionRow(db11, {
        id: "claude:null-model",
        kind: "transcript",
        rework_cycles: 4,
        model: null,
        model_family: null,
        excerpt: "sem modelo",
      });
      db11.close();

      chatCalls = 0;
      const out11 = join(f.tmpdir, "out11.md");
      const r11a = await runPingaAsync(
        [
          "learn",
          "propose",
          "--db",
          db11Path,
          "--out",
          out11,
          "--judge-endpoint",
          endpoint,
        ],
        f.env,
      );
      expect(r11a.exit).toBe(8);
      expect(r11a.stderr).toContain("model_unattested");
      expect(chatCalls).toBe(0);
      expect(existsSync(out11)).toBe(false);

      // Ambos os problemas -> exit 7
      const db11Both = openLearnDb(db11Path);
      insertSessionRow(db11Both, {
        id: "claude:qwen-2",
        kind: "transcript",
        rework_cycles: 4,
        model: "qwen3.8-flash",
        model_family: "qwen",
        excerpt: "feito por qwen",
      });
      db11Both.close();
      const r11b = await runPingaAsync(
        [
          "learn",
          "propose",
          "--db",
          db11Path,
          "--out",
          out11,
          "--judge-endpoint",
          endpoint,
        ],
        f.env,
      );
      expect(r11b.exit).toBe(7);
      expect(chatCalls).toBe(0);

      // 12. Atestado do juiz falha (endpoint morto e 2 modelos) -> exit 8, 0 chamadas
      const dbCleanPath = join(f.tmpdir, "db-clean.db");
      seedReferenceDb(dbCleanPath);
      const out12 = join(f.tmpdir, "out12.md");

      const r12a = await runPingaAsync(
        [
          "learn",
          "propose",
          "--db",
          dbCleanPath,
          "--out",
          out12,
          "--judge-endpoint",
          "http://127.0.0.1:9",
        ],
        f.env,
      );
      expect(r12a.exit).toBe(8);
      expect(existsSync(out12)).toBe(false);

      mode = "two_models";
      chatCalls = 0;
      const r12b = await runPingaAsync(
        [
          "learn",
          "propose",
          "--db",
          dbCleanPath,
          "--out",
          out12,
          "--judge-endpoint",
          endpoint,
        ],
        f.env,
      );
      expect(r12b.exit).toBe(8);
      expect(chatCalls).toBe(0);
      expect(existsSync(out12)).toBe(false);

      // 13. Falha no meio (HTTP 500 na 2ª chamada e resposta sem JSON) -> exit 8, nenhum arquivo
      mode = "fail_2nd";
      chatCalls = 0;
      const out13 = join(f.tmpdir, "out13.md");
      const r13a = await runPingaAsync(
        [
          "learn",
          "propose",
          "--db",
          dbCleanPath,
          "--out",
          out13,
          "--judge-endpoint",
          endpoint,
        ],
        f.env,
      );
      expect(r13a.exit).toBe(8);
      expect(existsSync(out13)).toBe(false);

      mode = "no_json";
      chatCalls = 0;
      const r13b = await runPingaAsync(
        [
          "learn",
          "propose",
          "--db",
          dbCleanPath,
          "--out",
          out13,
          "--judge-endpoint",
          endpoint,
        ],
        f.env,
      );
      expect(r13b.exit).toBe(8);
      expect(existsSync(out13)).toBe(false);
    } finally {
      srv.stop(true);
      cleanupFakeEnv(f);
    }
  });
});
