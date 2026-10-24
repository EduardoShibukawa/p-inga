import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CRITICAL_RULES,
  MODES,
  MODE_RAISED_BY,
  TRUNK_BRANCHES,
  currentBranch,
  isTrunkOrNight,
  matchesPattern,
  maxMode,
  modeRank,
  parseOverride,
  resolveMode,
  touchesCritical,
} from "../src/mode";
import { type Receipt, validateReceipt } from "../src/receipt";

const ROOT = join(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

function git(cwd: string, args: string[]) {
  const res = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr.toString()}`);
  }
  return res.stdout.toString().trim();
}

function makeReceipt(overrides: Partial<Receipt> & Record<string, unknown> = {}): Receipt {
  return {
    v: 1,
    type: "task.receipt",
    id: `rcpt-${Math.random()}`,
    task: "TX",
    status: "pass",
    reason_code: null,
    attempts: 1,
    evidence: [
      {
        kind: "command",
        cmd_sha256: "a".repeat(64),
        exit: 0,
        duration_ms: 10,
        artifact_ref: {
          path: "runs/TX/1/out.txt",
          sha256: "b".repeat(64),
        },
      },
    ],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: "not run",
    author: { model: "glm-5.3", family: "glm" },
    verified_by: null,
    summary: "TX pass: done_when exit 0 em 0s",
    created_at: "2026-10-24T22:00:00.000Z",
    ...overrides,
  } as Receipt;
}

function makeModeFixture(branch = "feat/x") {
  const repoDir = mkdtempSync(join(tmpdir(), "pinga-mode-repo-"));
  const ledgerDir = mkdtempSync(join(tmpdir(), "pinga-mode-ledger-"));
  const ledgerPath = join(ledgerDir, "ledger.db");

  git(repoDir, ["init", "-q", "-b", "main"]);
  git(repoDir, ["config", "user.email", "test@example.com"]);
  git(repoDir, ["config", "user.name", "Test User"]);
  if (branch !== "main") {
    git(repoDir, ["checkout", "-q", "-b", branch]);
  }

  mkdirSync(join(repoDir, "tasks/TX"), { recursive: true });
  const planPath = join(repoDir, "tasks/TX/PLAN.md");

  const writePlan = (
    opts: {
      mode?: string;
      touch?: string[];
      doneWhen?: string;
      extraLines?: number;
    } = {},
  ) => {
    const m = opts.mode ?? "mvp";
    const touch = opts.touch ?? ["src/a.ts"];
    const dw = opts.doneWhen ?? "true";
    const lines = [
      "---",
      `mode: ${m}`,
      'goal: "Mode test plan"',
      `done_when: ${JSON.stringify(dw)}`,
      `touch: ${JSON.stringify(touch)}`,
      'tests_frozen: ["tests/a.test.ts"]',
      "budget: { tokens: 100000, minutes: 5 }",
      "---",
      "## Passos",
      "- [ ] step",
      ...(opts.extraLines
        ? Array.from({ length: opts.extraLines }, (_, i) => `- [ ] extra ${i}`)
        : []),
    ];
    writeFileSync(planPath, `${lines.join("\n")}\n`);
    return planPath;
  };

  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "PINGA_MODE_NIGHT" && v !== undefined) {
      cleanEnv[k] = v;
    }
  }

  return {
    repoDir,
    ledgerDir,
    ledgerPath,
    planPath,
    writePlan,
    cleanEnv,
    cleanup: () => {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

describe("T09 — Monotonic Mode Router (I12)", () => {
  test("1. modeRank and maxMode total ordering", () => {
    expect(MODES).toEqual(["mvp", "padrao", "completo"]);
    expect(TRUNK_BRANCHES).toEqual(["main", "master"]);
    expect(MODE_RAISED_BY).toEqual([
      "requested",
      "diff_touches_migration",
      "diff_touches_auth",
      "diff_touches_public_api",
      "diff_touches_ci",
      "diff_touches_lockfile",
      "night_run",
      "trunk_branch",
      "operator_override",
    ]);
    expect(Array.isArray(CRITICAL_RULES)).toBe(true);

    expect(modeRank("mvp")).toBe(0);
    expect(modeRank("padrao")).toBe(1);
    expect(modeRank("completo")).toBe(2);
    expect(maxMode("mvp", "completo")).toBe("completo");
    expect(maxMode("padrao", "mvp")).toBe("padrao");
  });

  test("2 & 3. matchesPattern and touchesCritical rules and precedence", () => {
    expect(matchesPattern("migrations/001.sql", "**/migrations/**")).toBe(true);
    expect(matchesPattern("db/migrations/001.sql", "**/migrations/**")).toBe(true);

    for (const p of ["db/migrations/001.sql", "migrations/001.sql", "src/db/schema.ts"]) {
      expect(touchesCritical([p])?.raised_by).toBe("diff_touches_migration");
    }
    for (const p of ["src/auth/login.ts", "app/security/Policy.java"]) {
      expect(touchesCritical([p])?.raised_by).toBe("diff_touches_auth");
    }
    for (const p of [
      "src/api/owners.ts",
      "src/routes/index.ts",
      "openapi.yaml",
      "docs/openapi.json",
    ]) {
      expect(touchesCritical([p])?.raised_by).toBe("diff_touches_public_api");
    }
    for (const p of [".github/workflows/ci.yml", "Dockerfile", "docker/Dockerfile"]) {
      expect(touchesCritical([p])?.raised_by).toBe("diff_touches_ci");
    }
    for (const p of [
      "bun.lock",
      "bun.lockb",
      "package-lock.json",
      "web/yarn.lock",
      "go.sum",
    ]) {
      expect(touchesCritical([p])?.raised_by).toBe("diff_touches_lockfile");
    }
    for (const p of [
      "src/a.ts",
      "README.md",
      "src/authors.ts",
      "src/apiary.ts",
      "Dockerfile.md",
    ]) {
      expect(touchesCritical([p])).toBeNull();
    }

    expect(
      touchesCritical([
        "bun.lock",
        ".github/x.yml",
        "src/auth/b.ts",
        "src/auth/a.ts",
        "src/auth/a.ts",
      ]),
    ).toEqual({
      raised_by: "diff_touches_auth",
      files: ["src/auth/a.ts", "src/auth/b.ts"],
    });
  });

  test("4. isTrunkOrNight checks PINGA_MODE_NIGHT=1 first, then main/master branch", () => {
    expect(isTrunkOrNight("main", {})).toBe("trunk_branch");
    expect(isTrunkOrNight("master", {})).toBe("trunk_branch");
    expect(isTrunkOrNight("feat/x", {})).toBeNull();
    expect(isTrunkOrNight("mainline", {})).toBeNull();
    expect(isTrunkOrNight(null, {})).toBeNull();
    expect(isTrunkOrNight("feat/x", { PINGA_MODE_NIGHT: "0" })).toBeNull();
    expect(isTrunkOrNight("feat/x", { PINGA_MODE_NIGHT: "1" })).toBe("night_run");
    expect(isTrunkOrNight("main", { PINGA_MODE_NIGHT: "1" })).toBe("night_run");
  });

  test("5, 6 & 7. resolveMode table, operator override and monotonicity", () => {
    const cases: Array<{
      requested: "mvp" | "padrao" | "completo";
      paths: string[];
      branch: string | null;
      env?: Record<string, string | undefined>;
      effective: "mvp" | "padrao" | "completo";
      raised_by: string;
      signals: string[];
    }> = [
      {
        requested: "mvp",
        paths: [],
        branch: "feat/x",
        effective: "mvp",
        raised_by: "requested",
        signals: [],
      },
      {
        requested: "mvp",
        paths: [],
        branch: "main",
        effective: "padrao",
        raised_by: "trunk_branch",
        signals: ["trunk_branch"],
      },
      {
        requested: "mvp",
        paths: ["db/m/1.sql"],
        branch: "main",
        effective: "completo",
        raised_by: "diff_touches_migration",
        signals: ["diff_touches_migration", "trunk_branch"],
      },
      {
        requested: "padrao",
        paths: [],
        branch: "main",
        effective: "padrao",
        raised_by: "requested",
        signals: ["trunk_branch"],
      },
      {
        requested: "completo",
        paths: [],
        branch: "feat/x",
        effective: "completo",
        raised_by: "requested",
        signals: [],
      },
      {
        requested: "completo",
        paths: ["src/auth/a.ts"],
        branch: "feat/x",
        effective: "completo",
        raised_by: "requested",
        signals: ["diff_touches_auth"],
      },
      {
        requested: "padrao",
        paths: ["bun.lock", "src/api/x.ts"],
        branch: "feat/x",
        effective: "completo",
        raised_by: "diff_touches_public_api",
        signals: ["diff_touches_public_api", "diff_touches_lockfile"],
      },
      {
        requested: "mvp",
        paths: [],
        branch: "feat/x",
        env: { PINGA_MODE_NIGHT: "1" },
        effective: "padrao",
        raised_by: "night_run",
        signals: ["night_run"],
      },
    ];

    for (const c of cases) {
      const res = resolveMode({
        requested: c.requested,
        paths: c.paths,
        branch: c.branch,
        env: c.env ?? {},
      });
      expect(res.effective).toBe(c.effective);
      expect(res.raised_by).toBe(c.raised_by as typeof res.raised_by);
      expect(res.signals).toEqual(c.signals as typeof res.signals);
      expect(res.override).toBeNull();
      expect(modeRank(res.effective)).toBeGreaterThanOrEqual(modeRank(c.requested));

      // Check monotonicity across all requested modes for this row
      for (const req of MODES) {
        const mRes = resolveMode({
          requested: req,
          paths: c.paths,
          branch: c.branch,
          env: c.env ?? {},
        });
        expect(modeRank(mRes.effective)).toBeGreaterThanOrEqual(modeRank(req));
      }
    }

    // Case 6: Override
    const ov1 = resolveMode({
      requested: "padrao",
      paths: ["db/m/1.sql"],
      branch: "main",
      env: {},
      override: { mode: "mvp", reason: "spike descartável" },
    });
    expect(ov1.effective).toBe("mvp");
    expect(ov1.raised_by).toBe("operator_override");
    expect(ov1.override).toEqual({
      from: "completo",
      to: "mvp",
      reason: "spike descartável",
    });

    const ovSame = resolveMode({
      requested: "padrao",
      paths: ["db/m/1.sql"],
      branch: "main",
      env: {},
      override: { mode: "completo", reason: "confirmado" },
    });
    expect(ovSame.effective).toBe("completo");
    expect(ovSame.raised_by).toBe("operator_override");
    expect(ovSame.override).toEqual({
      from: "completo",
      to: "completo",
      reason: "confirmado",
    });
  });

  test("8, 9 & 10. parseOverride, validateReceipt mode fields, and currentBranch", () => {
    expect(parseOverride(undefined, undefined)).toEqual({ ok: true, override: null });
    expect(parseOverride("mvp", undefined).ok).toBe(false);
    expect(parseOverride(undefined, "x").ok).toBe(false);
    expect(parseOverride("rapido", "x").ok).toBe(false);
    expect(parseOverride("mvp", "   ").ok).toBe(false);
    expect(parseOverride("mvp", "a".repeat(281)).ok).toBe(false);
    expect(parseOverride("mvp", "  ok  ")).toEqual({
      ok: true,
      override: { mode: "mvp", reason: "ok" },
    });

    expect(validateReceipt(makeReceipt({ mode_effective: "rapido" as "mvp" })).ok).toBe(false);
    expect(
      validateReceipt(makeReceipt({ mode_raised_by: "x" as "requested" })).ok,
    ).toBe(false);
    expect(
      validateReceipt(makeReceipt({ mode_raised_by: "operator_override" })).ok,
    ).toBe(false);
    expect(
      validateReceipt(
        makeReceipt({
          mode_raised_by: "requested",
          mode_override: { from: "completo", to: "mvp", reason: "ok" },
        }),
      ).ok,
    ).toBe(false);
    const extraOv = validateReceipt(
      makeReceipt({
        mode_raised_by: "operator_override",
        mode_override: {
          from: "completo",
          to: "mvp",
          reason: "ok",
          extra: 1,
        } as unknown as Receipt["mode_override"],
      }),
    );
    expect(extraOv.ok).toBe(false);
    if (!extraOv.ok) {
      expect(extraOv.errors.some((e) => e.includes("mode_override.extra"))).toBe(true);
    }
    expect(
      validateReceipt(
        makeReceipt({
          mode_effective: "completo",
          mode_raised_by: "diff_touches_ci",
        }),
      ).ok,
    ).toBe(true);

    const tmpRepo = mkdtempSync(join(tmpdir(), "pinga-branch-"));
    try {
      git(tmpRepo, ["init", "-q", "-b", "main"]);
      expect(currentBranch(tmpRepo)).toBe("main");
      git(tmpRepo, ["checkout", "-q", "-b", "feat/x"]);
      expect(currentBranch(tmpRepo)).toBe("feat/x");
      git(tmpRepo, ["config", "user.email", "a@b.c"]);
      git(tmpRepo, ["config", "user.name", "A"]);
      writeFileSync(join(tmpRepo, "f"), "1");
      git(tmpRepo, ["add", "f"]);
      git(tmpRepo, ["commit", "-m", "init"]);
      git(tmpRepo, ["checkout", "-q", "--detach"]);
      expect(currentBranch(tmpRepo)).toBeNull();
    } finally {
      rmSync(tmpRepo, { recursive: true, force: true });
    }
  });

  test("11..23. CLI pinga mode and pinga verify mode integration", () => {
    const f = makeModeFixture("feat/x");
    try {
      // 11. pinga mode on mvp plan without RED -> effective: mvp, no files created in ledgerDir
      const p = f.writePlan({ mode: "mvp", touch: ["src/a.ts"] });
      const r11 = Bun.spawnSync(["bun", BIN, "mode", p], { cwd: ROOT, env: f.cleanEnv });
      expect(r11.exitCode).toBe(0);
      const dec11 = JSON.parse(r11.stdout.toString().trim());
      expect(dec11.task).toBe("TX");
      expect(dec11.effective).toBe("mvp");
      expect(dec11.raised_by).toBe("requested");
      expect(readdirSync(f.ledgerDir).length).toBe(0);

      // 12. touch includes db/migrations/001.sql -> completo, diff_touches_migration
      f.writePlan({ mode: "mvp", touch: ["src/a.ts", "db/migrations/001.sql"] });
      const r12 = Bun.spawnSync(["bun", BIN, "mode", p], { cwd: ROOT, env: f.cleanEnv });
      expect(r12.exitCode).toBe(0);
      const dec12 = JSON.parse(r12.stdout.toString().trim());
      expect(dec12.effective).toBe("completo");
      expect(dec12.raised_by).toBe("diff_touches_migration");

      // 14. Night run and main branch
      f.writePlan({ mode: "mvp", touch: ["src/a.ts"] });
      const r14Night = Bun.spawnSync(["bun", BIN, "mode", p], {
        cwd: ROOT,
        env: { ...f.cleanEnv, PINGA_MODE_NIGHT: "1" },
      });
      expect(JSON.parse(r14Night.stdout.toString().trim()).raised_by).toBe("night_run");

      git(f.repoDir, ["checkout", "-q", "-B", "main"]);
      const r14Main = Bun.spawnSync(["bun", BIN, "mode", p], { cwd: ROOT, env: f.cleanEnv });
      expect(JSON.parse(r14Main.stdout.toString().trim())).toMatchObject({
        effective: "padrao",
        raised_by: "trunk_branch",
      });
      git(f.repoDir, ["checkout", "-q", "-B", "feat/x"]);

      // 15. Override on CLI mode
      f.writePlan({ mode: "mvp", touch: ["db/migrations/001.sql"] });
      const r15 = Bun.spawnSync(
        ["bun", BIN, "mode", p, "--override-mode", "mvp", "--reason", "x"],
        { cwd: ROOT, env: f.cleanEnv },
      );
      expect(r15.exitCode).toBe(0);
      const dec15 = JSON.parse(r15.stdout.toString().trim());
      expect(dec15.raised_by).toBe("operator_override");
      expect(dec15.override.from).toBe("completo");

      expect(
        Bun.spawnSync(["bun", BIN, "mode", p, "--override-mode", "mvp"], {
          cwd: ROOT,
          env: f.cleanEnv,
        }).exitCode,
      ).toBe(2);
      expect(
        Bun.spawnSync(["bun", BIN, "mode", p, "--override-mode", "rapido", "--reason", "x"], {
          cwd: ROOT,
          env: f.cleanEnv,
        }).exitCode,
      ).toBe(2);
      expect(
        Bun.spawnSync(["bun", BIN, "mode", p, "--reason", "x"], {
          cwd: ROOT,
          env: f.cleanEnv,
        }).exitCode,
      ).toBe(2);

      // 16. verify in feat/x, mvp -> mode_effective: mvp, raised_by: requested, no flow, no mode_override
      f.writePlan({ mode: "mvp", touch: ["src/a.ts"], doneWhen: "true" });
      const r16 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", f.ledgerPath], {
        cwd: ROOT,
        env: f.cleanEnv,
      });
      expect(r16.exitCode).toBe(0);
      const rcpt16 = JSON.parse(r16.stdout.toString().trim());
      expect(rcpt16.mode_effective).toBe("mvp");
      expect(rcpt16.mode_raised_by).toBe("requested");
      expect(rcpt16.flow).toBeUndefined();
      expect(rcpt16.mode_override).toBeUndefined();
      expect(validateReceipt(rcpt16).ok).toBe(true);

      // 17. verify in main, mvp -> mode_effective: padrao, mode_raised_by: trunk_branch
      git(f.repoDir, ["checkout", "-q", "-B", "main"]);
      const r17 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", f.ledgerPath], {
        cwd: ROOT,
        env: f.cleanEnv,
      });
      expect(r17.exitCode).toBe(0);
      const rcpt17 = JSON.parse(r17.stdout.toString().trim());
      expect(rcpt17.mode_effective).toBe("padrao");
      expect(rcpt17.mode_raised_by).toBe("trunk_branch");
      expect(validateReceipt(rcpt17).ok).toBe(true);
      git(f.repoDir, ["checkout", "-q", "-B", "feat/x"]);

      // 18. verify in feat/x, touch: ["src/auth/login.ts"], pass -> completo, awaiting_judge, next_action: "pinga judge"
      f.writePlan({ mode: "padrao", touch: ["src/auth/login.ts"], doneWhen: "true" });
      const r18 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", f.ledgerPath], {
        cwd: ROOT,
        env: f.cleanEnv,
      });
      expect(r18.exitCode).toBe(0);
      const rcpt18 = JSON.parse(r18.stdout.toString().trim());
      expect(rcpt18.mode_effective).toBe("completo");
      expect(rcpt18.mode_raised_by).toBe("diff_touches_auth");
      expect(rcpt18.flow).toBe("awaiting_judge");
      expect(rcpt18.next_action).toBe("pinga judge");
      expect(validateReceipt(rcpt18).ok).toBe(true);

      // 19. same plan with exit 7 -> exit 1, fail, mode fields present, no flow
      f.writePlan({ mode: "padrao", touch: ["src/auth/login.ts"], doneWhen: "exit 7" });
      const r19 = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", f.ledgerPath], {
        cwd: ROOT,
        env: f.cleanEnv,
      });
      expect(r19.exitCode).toBe(1);
      const rcpt19 = JSON.parse(r19.stdout.toString().trim());
      expect(rcpt19.status).toBe("fail");
      expect(rcpt19.mode_effective).toBe("completo");
      expect(rcpt19.flow).toBeUndefined();
      expect(validateReceipt(rcpt19).ok).toBe(true);

      // 21. verify with --override-mode padrao --reason "auth só em teste" on case 18 plan -> pass, no flow
      f.writePlan({ mode: "padrao", touch: ["src/auth/login.ts"], doneWhen: "true" });
      const r21 = Bun.spawnSync(
        [
          "bun",
          BIN,
          "verify",
          p,
          "--ledger",
          f.ledgerPath,
          "--override-mode",
          "padrao",
          "--reason",
          "auth só em teste",
        ],
        { cwd: ROOT, env: f.cleanEnv },
      );
      expect(r21.exitCode).toBe(0);
      const rcpt21 = JSON.parse(r21.stdout.toString().trim());
      expect(rcpt21.mode_effective).toBe("padrao");
      expect(rcpt21.mode_raised_by).toBe("operator_override");
      expect(rcpt21.mode_override).toEqual({
        from: "completo",
        to: "padrao",
        reason: "auth só em teste",
      });
      expect(rcpt21.flow).toBeUndefined();
      expect(validateReceipt(rcpt21).ok).toBe(true);

      // 22. verify --override-mode mvp without --reason -> exit 2, no new receipt
      const r22 = Bun.spawnSync(
        ["bun", BIN, "verify", p, "--ledger", f.ledgerPath, "--override-mode", "mvp"],
        { cwd: ROOT, env: f.cleanEnv },
      );
      expect(r22.exitCode).toBe(2);

      // 13 & 20: With commits chore: init and test(TX): RED
      mkdirSync(join(f.repoDir, "src"), { recursive: true });
      mkdirSync(join(f.repoDir, "tests"), { recursive: true });
      writeFileSync(join(f.repoDir, ".gitignore"), "runs/\n.pinga/\n*.db\n");
      writeFileSync(join(f.repoDir, "src/a.ts"), "export const a = 1;\n");
      writeFileSync(join(f.repoDir, "tests/a.test.ts"), "// init\n");
      f.writePlan({ mode: "mvp", touch: ["src/a.ts"], doneWhen: "true" });
      git(f.repoDir, ["add", ".gitignore", "tasks/TX/PLAN.md", "src/a.ts", "tests/a.test.ts"]);
      git(f.repoDir, ["commit", "-m", "chore: init"]);
      const initSha = git(f.repoDir, ["rev-parse", "HEAD"]);

      writeFileSync(join(f.repoDir, "tests/a.test.ts"), "// RED\n");
      git(f.repoDir, ["add", "tests/a.test.ts"]);
      git(f.repoDir, ["commit", "-m", "test(TX): RED"]);

      // 13. Untracked .github/workflows/x.yml -> completo, diff_touches_ci
      mkdirSync(join(f.repoDir, ".github/workflows"), { recursive: true });
      writeFileSync(join(f.repoDir, ".github/workflows/x.yml"), "name: ci\n");
      const r13a = Bun.spawnSync(["bun", BIN, "mode", p], { cwd: ROOT, env: f.cleanEnv });
      expect(JSON.parse(r13a.stdout.toString().trim())).toMatchObject({
        effective: "completo",
        raised_by: "diff_touches_ci",
      });
      const r13b = Bun.spawnSync(["bun", BIN, "mode", p, "--base", initSha], {
        cwd: ROOT,
        env: f.cleanEnv,
      });
      expect(JSON.parse(r13b.stdout.toString().trim())).toMatchObject({
        effective: "completo",
        raised_by: "diff_touches_ci",
      });
      rmSync(join(f.repoDir, ".github"), { recursive: true, force: true });

      // 20a. Guard block (src/extra.ts untracked) -> exit 6, scope_drift with mode fields
      writeFileSync(join(f.repoDir, "src/extra.ts"), "export const e = 1;\n");
      const r20a = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", f.ledgerPath], {
        cwd: ROOT,
        env: f.cleanEnv,
      });
      expect(r20a.exitCode).toBe(6);
      const rcpt20a = JSON.parse(r20a.stdout.toString().trim());
      expect(rcpt20a.reason_code).toBe("scope_drift");
      expect(rcpt20a.mode_effective).toBe("mvp");
      expect(validateReceipt(rcpt20a).ok).toBe(true);

      // 20b. 26-line invalid plan -> exit 3, plan_invalid WITHOUT mode_effective
      f.writePlan({ mode: "mvp", touch: ["src/a.ts"], extraLines: 16 });
      const r20b = Bun.spawnSync(["bun", BIN, "verify", p, "--ledger", f.ledgerPath], {
        cwd: ROOT,
        env: f.cleanEnv,
      });
      expect(r20b.exitCode).toBe(3);
      const rcpt20b = JSON.parse(r20b.stdout.toString().trim());
      expect(rcpt20b.reason_code).toBe("plan_invalid");
      expect(rcpt20b.mode_effective).toBeUndefined();
      expect(validateReceipt(rcpt20b).ok).toBe(true);

      // 23. Ledger verify ok
      const lv = Bun.spawnSync(["bun", BIN, "ledger", "verify", "--ledger", f.ledgerPath], {
        cwd: ROOT,
      });
      expect(lv.exitCode).toBe(0);
      expect(lv.stdout.toString().trim()).toBe("ok 7");
    } finally {
      f.cleanup();
    }
  });
});
