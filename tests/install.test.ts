import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CLAUDE_MARKETPLACE,
  CLAUDE_PLUGIN_KEY,
  claudeAdapter,
} from "../src/adapters/claude";
import {
  INSTALL_EXIT,
  type Adapter,
  checkForeign,
  installCmd,
} from "../src/install";
import {
  MANIFEST_VERSION,
  type Manifest,
  backupFile,
  defaultManifestPath,
  defaultStateDir,
  readManifest,
  sha256File,
  validateManifest,
  writeAtomic,
} from "../src/manifest";
import {
  SHADOW_PREFIX,
  escapePointer,
  jsonPointerDiff,
  renderDiff,
  withShadow,
} from "../src/shadow";
import {
  NOW,
  PLUGIN_KEY,
  makeRealisticHome,
  runPinga,
  shadowLeftovers,
  tmp,
  treeHash,
} from "./helpers/home";

function sha256hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("T12 — pinga install e adaptador Claude Code (I16 / I17) — Unitários", () => {
  test("1. jsonPointerDiff e escapePointer", () => {
    expect(SHADOW_PREFIX).toBe("pinga-shadow-");
    expect(escapePointer("a/b")).toBe("a~1b");
    expect(escapePointer("m~n")).toBe("m~0n");

    expect(
      jsonPointerDiff({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3, d: 4 } }),
    ).toEqual([
      { op: "~", pointer: "/b/c", before: 2, after: 3 },
      { op: "+", pointer: "/b/d", after: 4 },
    ]);

    expect(jsonPointerDiff({ x: [1, 2] }, { x: [1] })).toEqual([
      { op: "-", pointer: "/x/1", before: 2 },
    ]);

    expect(
      jsonPointerDiff({ "a/b": 1, "m~n": 2 }, { "a/b": 2, "m~n": 3 }),
    ).toEqual([
      { op: "~", pointer: "/a~1b", before: 1, after: 2 },
      { op: "~", pointer: "/m~0n", before: 2, after: 3 },
    ]);

    expect(
      jsonPointerDiff(
        { a: 1, b: { c: 2 } },
        { a: 1, b: { c: 3, d: 4 } },
        ["/b"],
      ),
    ).toEqual([]);

    expect(jsonPointerDiff({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual(
      [],
    );

    expect(jsonPointerDiff({ x: [] }, { x: [1] })).toEqual([
      { op: "+", pointer: "/x/0", after: 1 },
    ]);

    expect(jsonPointerDiff({ x: [] }, { x: {} })).toEqual([
      { op: "~", pointer: "/x", before: [], after: {} },
    ]);
  });

  test("2. validateManifest", () => {
    expect(MANIFEST_VERSION).toBe(1);
    const valid: Manifest = {
      version: 1,
      entries: [
        {
          harness: "claude",
          target_file: ".claude/settings.json",
          key_path: "/enabledPlugins/pi-harness@pi-harness-local",
          sha256_pre: "a".repeat(64),
          sha256_post: "b".repeat(64),
          installed_at: NOW,
          backup_path: "/tmp/backups/" + "a".repeat(64),
        },
        {
          harness: "claude",
          target_file: ".claude/plugins/known_marketplaces.json",
          sha256_pre: "absent",
          sha256_post: "c".repeat(64),
          installed_at: NOW,
          backup_path: "",
        },
      ],
    };
    expect(validateManifest(valid).ok).toBe(true);

    // Rejeições
    expect(validateManifest({ version: 2, entries: [] }).ok).toBe(false);
    expect(
      validateManifest({
        version: 1,
        entries: [{ ...valid.entries[0], harness: "agy" }],
      }).ok,
    ).toBe(false);
    expect(
      validateManifest({
        version: 1,
        entries: [{ ...valid.entries[0], sha256_pre: "xyz" }],
      }).ok,
    ).toBe(false);
    expect(
      validateManifest({
        version: 1,
        entries: [{ ...valid.entries[0], extraKey: 1 }],
      }).ok,
    ).toBe(false);
    const noBackup = { ...valid.entries[0] } as Record<string, unknown>;
    delete noBackup.backup_path;
    expect(validateManifest({ version: 1, entries: [noBackup] }).ok).toBe(false);
    expect(
      validateManifest({
        version: 1,
        entries: [
          {
            ...valid.entries[1],
            sha256_pre: "absent",
            backup_path: "/tmp/nao-vazio",
          },
        ],
      }).ok,
    ).toBe(false);
  });

  test("3. writeAtomic e sha256File", () => {
    const d = tmp("pinga-t12-atomic-");
    try {
      const p = join(d, "sub/file.txt");
      writeAtomic(p, "hello atomic\n");
      expect(readFileSync(p, "utf8")).toBe("hello atomic\n");
      expect(readdirSync(join(d, "sub"))).toEqual(["file.txt"]);
      expect(sha256File(p)).toBe(sha256hex("hello atomic\n"));
      expect(sha256File(join(d, "inexistente.txt"))).toBe("absent");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("4. backupFile duas vezes no mesmo arquivo -> mesmo backup_path, bytes idênticos, 1 arquivo em backups/", () => {
    const d = tmp("pinga-t12-backup-");
    try {
      const stateDir = join(d, "state");
      const srcFile = join(d, "orig.json");
      writeFileSync(srcFile, '{"k":1}\n');
      const b1 = backupFile(stateDir, srcFile);
      const b2 = backupFile(stateDir, srcFile);
      expect(b1.backup_path).toBe(b2.backup_path);
      expect(b1.backup_path).toBe(
        join(stateDir, "backups", sha256hex('{"k":1}\n')),
      );
      expect(readFileSync(b1.backup_path, "utf8")).toBe('{"k":1}\n');
      expect(readdirSync(join(stateDir, "backups")).length).toBe(1);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("5. checkForeign com adaptador falso", () => {
    const fakeAdapter: Adapter = {
      harness: "claude",
      targets: ["s.json"],
      owned: { "s.json": ["/enabledPlugins/k"] },
      volatile: {},
      apply() {},
    };
    const emptyManifest: Manifest = { version: 1, entries: [] };

    // Mudança em /theme -> { ok: false, pointers: ["/theme"] }
    const c1 = checkForeign({
      adapter: fakeAdapter,
      file: "s.json",
      before: { theme: "dark" },
      after: { theme: "light", enabledPlugins: { k: true } },
      changes: [
        { op: "+", pointer: "/enabledPlugins/k", after: true },
        { op: "~", pointer: "/theme", before: "dark", after: "light" },
      ],
      manifest: emptyManifest,
    });
    expect(c1).toEqual({ ok: false, pointers: ["/theme"] });

    // before com /enabledPlugins/k e manifest vazio -> homônima recusada
    const c2 = checkForeign({
      adapter: fakeAdapter,
      file: "s.json",
      before: { enabledPlugins: { k: false } },
      after: { enabledPlugins: { k: true } },
      changes: [{ op: "~", pointer: "/enabledPlugins/k", before: false, after: true }],
      manifest: emptyManifest,
    });
    expect(c2).toEqual({ ok: false, pointers: ["/enabledPlugins/k"] });

    // Mesma coisa com entrada registrada no manifest -> ok
    const c3 = checkForeign({
      adapter: fakeAdapter,
      file: "s.json",
      before: { enabledPlugins: { k: false } },
      after: { enabledPlugins: { k: true } },
      changes: [{ op: "~", pointer: "/enabledPlugins/k", before: false, after: true }],
      manifest: {
        version: 1,
        entries: [
          {
            harness: "claude",
            target_file: "s.json",
            key_path: "/enabledPlugins/k",
            sha256_pre: "a".repeat(64),
            sha256_post: "b".repeat(64),
            installed_at: NOW,
            backup_path: "/tmp/b",
          },
        ],
      },
    });
    expect(c3).toEqual({ ok: true });

    // Alvo sem before (undefined) -> ok
    const c4 = checkForeign({
      adapter: fakeAdapter,
      file: "s.json",
      before: undefined,
      after: { enabledPlugins: { k: true } },
      changes: [{ op: "+", pointer: "/enabledPlugins/k", after: true }],
      manifest: emptyManifest,
    });
    expect(c4).toEqual({ ok: true });
  });
});

describe("T12 — pinga install e adaptador Claude Code (I16 / I17) — CLI & Fluxo Completo", () => {
  function cleanupFakeEnv(f: ReturnType<typeof makeRealisticHome>) {
    rmSync(f.home, { recursive: true, force: true });
    rmSync(f.state, { recursive: true, force: true });
    rmSync(f.tmpdir, { recursive: true, force: true });
    rmSync(f.source, { recursive: true, force: true });
  }

  test("6–10. T1 dry-run, apply, apply sem revisão, T2 idempotência (incluindo PINGA_NOW diferente) e T3 revert", () => {
    const f = makeRealisticHome();
    try {
      const beforeTree = treeHash(f.home);
      const beforeSettings = JSON.parse(
        readFileSync(join(f.home, ".claude/settings.json"), "utf8"),
      );
      const beforeSettingsSha = sha256File(join(f.home, ".claude/settings.json"));
      const beforeInstalledSha = sha256File(
        join(f.home, ".claude/plugins/installed_plugins.json"),
      );
      const beforeMktSha = sha256File(
        join(f.home, ".claude/plugins/known_marketplaces.json"),
      );

      // 8a. Apply sem dry-run prévio -> exit 2
      const applyNoDry = runPinga(["install", "--apply"], f.env);
      expect(applyNoDry.exit).toBe(2);
      expect(applyNoDry.stderr).toContain("--dry-run");
      expect(treeHash(f.home)).toEqual(beforeTree);

      // 6. T1 dry-run
      const dry = runPinga(["install", "--dry-run"], f.env);
      expect(dry.exit).toBe(0);
      expect(dry.stdout.startsWith("=== claude ===")).toBe(true);
      expect(dry.stdout).toContain(".claude/settings.json");
      expect(dry.stdout).toContain(".claude/plugins/installed_plugins.json");
      expect(dry.stdout).toContain(".claude/plugins/known_marketplaces.json");
      expect(dry.stdout).toContain(
        `+ /enabledPlugins/${PLUGIN_KEY}: true`,
      );
      expect(treeHash(f.home)).toEqual(beforeTree);
      const manifestPath = defaultManifestPath(f.env);
      expect(existsSync(manifestPath)).toBe(false);
      const planJsonPath = join(defaultStateDir(f.env), "install-plan.json");
      expect(existsSync(planJsonPath)).toBe(true);
      expect(shadowLeftovers(f.tmpdir)).toEqual([]);

      // 7. Apply
      const app = runPinga(["install", "--apply"], f.env);
      expect(app.exit).toBe(0);

      const afterSettings = JSON.parse(
        readFileSync(join(f.home, ".claude/settings.json"), "utf8"),
      );
      expect(afterSettings.theme).toEqual(beforeSettings.theme);
      expect(afterSettings.model).toEqual(beforeSettings.model);
      expect(afterSettings.hooks).toEqual(beforeSettings.hooks);
      expect(afterSettings.enabledPlugins["other@mkt"]).toBe(true);
      expect(afterSettings.enabledPlugins[PLUGIN_KEY]).toBe(true);

      const afterInstalled = JSON.parse(
        readFileSync(
          join(f.home, ".claude/plugins/installed_plugins.json"),
          "utf8",
        ),
      );
      expect(afterInstalled.plugins["other@mkt"]).toBeDefined();
      expect(afterInstalled.plugins[PLUGIN_KEY][0]).toEqual({
        scope: "user",
        installPath: `${f.source}/claude-plugin`,
        version: "local",
        installedAt: NOW,
        lastUpdated: NOW,
      });

      const afterMkt = JSON.parse(
        readFileSync(
          join(f.home, ".claude/plugins/known_marketplaces.json"),
          "utf8",
        ),
      );
      expect(afterMkt.mkt).toBeDefined();
      expect(afterMkt[CLAUDE_MARKETPLACE].source).toEqual({
        source: "directory",
        path: f.source,
      });

      const m = readManifest(manifestPath);
      expect(validateManifest(m).ok).toBe(true);
      expect(m.entries.length).toBe(3);
      for (const entry of m.entries) {
        expect(entry.harness).toBe("claude");
        expect(entry.key_path).toBeDefined();
        expect(existsSync(entry.backup_path)).toBe(true);
        expect(sha256File(entry.backup_path)).toBe(entry.sha256_pre);
        expect(sha256File(join(f.home, entry.target_file))).toBe(
          entry.sha256_post,
        );
      }
      expect(
        m.entries.find((e) => e.target_file === ".claude/settings.json")
          ?.sha256_pre,
      ).toBe(beforeSettingsSha);
      expect(
        m.entries.find(
          (e) => e.target_file === ".claude/plugins/installed_plugins.json",
        )?.sha256_pre,
      ).toBe(beforeInstalledSha);
      expect(
        m.entries.find(
          (e) => e.target_file === ".claude/plugins/known_marketplaces.json",
        )?.sha256_pre,
      ).toBe(beforeMktSha);

      expect(existsSync(planJsonPath)).toBe(false);
      expect(shadowLeftovers(f.tmpdir)).toEqual([]);

      // 9. T2 idempotência
      const treeAfterApply = treeHash(f.home);
      const manifestBytesAfterApply = readFileSync(manifestPath, "utf8");
      const backupsDir = join(defaultStateDir(f.env), "backups");
      const backupCountAfterApply = readdirSync(backupsDir).length;

      const dry2 = runPinga(["install", "--dry-run"], f.env);
      expect(dry2.exit).toBe(0);
      expect(dry2.stdout).toBe("");

      const app2 = runPinga(["install", "--apply"], f.env);
      expect(app2.exit).toBe(0);
      expect(app2.stdout).toBe("");
      expect(treeHash(f.home)).toEqual(treeAfterApply);
      expect(readFileSync(manifestPath, "utf8")).toBe(manifestBytesAfterApply);
      expect(readdirSync(backupsDir).length).toBe(backupCountAfterApply);

      // Idempotência com PINGA_NOW diferente (campo volátil mascarado)
      const envLater = { ...f.env, PINGA_NOW: "2026-10-25T00:00:00.000Z" };
      const dryLater = runPinga(["install", "--dry-run"], envLater);
      expect(dryLater.exit).toBe(0);
      expect(dryLater.stdout).toBe("");
      const appLater = runPinga(["install", "--apply"], envLater);
      expect(appLater.exit).toBe(0);
      expect(treeHash(f.home)).toEqual(treeAfterApply);

      // 10. T3 revert
      const rev = runPinga(["install", "--revert"], f.env);
      expect(rev.exit).toBe(0);
      expect(treeHash(f.home)).toEqual(beforeTree);
      expect(readManifest(manifestPath).entries).toEqual([]);
    } finally {
      cleanupFakeEnv(f);
    }

    // 8b. Dry-run, depois apagar installed_plugins.json (diff muda), depois apply -> exit 2
    const fDiff = makeRealisticHome();
    try {
      expect(runPinga(["install", "--dry-run"], fDiff.env).exit).toBe(0);
      unlinkSync(join(fDiff.home, ".claude/plugins/installed_plugins.json"));
      const appChanged = runPinga(["install", "--apply"], fDiff.env);
      expect(appChanged.exit).toBe(2);
      expect(appChanged.stderr).toContain("--dry-run");
    } finally {
      cleanupFakeEnv(fDiff);
    }

    // 10b. Com omit de known_marketplaces.json: apply cria (sem key_path, sha256_pre: "absent") e revert apaga
    const fOmit = makeRealisticHome({
      omit: [".claude/plugins/known_marketplaces.json"],
    });
    try {
      const beforeOmitTree = treeHash(fOmit.home);
      expect(runPinga(["install", "--dry-run"], fOmit.env).exit).toBe(0);
      expect(runPinga(["install", "--apply"], fOmit.env).exit).toBe(0);
      const mOmit = readManifest(defaultManifestPath(fOmit.env));
      const mktEntry = mOmit.entries.find(
        (e) => e.target_file === ".claude/plugins/known_marketplaces.json",
      );
      expect(mktEntry).toBeDefined();
      expect(mktEntry?.key_path).toBeUndefined();
      expect(mktEntry?.sha256_pre).toBe("absent");
      expect(mktEntry?.backup_path).toBe("");

      expect(runPinga(["install", "--revert"], fOmit.env).exit).toBe(0);
      expect(
        existsSync(join(fOmit.home, ".claude/plugins/known_marketplaces.json")),
      ).toBe(false);
      expect(treeHash(fOmit.home)).toEqual(beforeOmitTree);
    } finally {
      cleanupFakeEnv(fOmit);
    }
  });

  test("11 & 12. Revert com drift (exit 13) e backup corrompido/ausente (exit 14)", () => {
    // 11. Drift
    const f11 = makeRealisticHome();
    try {
      expect(runPinga(["install", "--dry-run"], f11.env).exit).toBe(0);
      expect(runPinga(["install", "--apply"], f11.env).exit).toBe(0);
      const manifestBefore = readFileSync(defaultManifestPath(f11.env), "utf8");
      const m = readManifest(defaultManifestPath(f11.env));

      const settingsPath = join(f11.home, ".claude/settings.json");
      const s = JSON.parse(readFileSync(settingsPath, "utf8"));
      s.theme = "light";
      writeFileSync(settingsPath, JSON.stringify(s, null, 2) + "\n");

      const rev11 = runPinga(["install", "--revert"], f11.env);
      expect(rev11.exit).toBe(13);
      expect(rev11.stderr).toContain(".claude/settings.json");
      // Os outros dois alvos continuam com sha256_post e o manifest não muda
      for (const entry of m.entries) {
        if (entry.target_file !== ".claude/settings.json") {
          expect(sha256File(join(f11.home, entry.target_file))).toBe(
            entry.sha256_post,
          );
        }
      }
      expect(readFileSync(defaultManifestPath(f11.env), "utf8")).toBe(
        manifestBefore,
      );
    } finally {
      cleanupFakeEnv(f11);
    }

    // 12. Backup corrompido e backup apagado -> exit 14
    const f12 = makeRealisticHome();
    try {
      expect(runPinga(["install", "--dry-run"], f12.env).exit).toBe(0);
      expect(runPinga(["install", "--apply"], f12.env).exit).toBe(0);
      const treeAfterApply = treeHash(f12.home);
      const m = readManifest(defaultManifestPath(f12.env));
      const bPath = m.entries[0]!.backup_path;

      writeFileSync(bPath, "corrompido");
      const revCorrupt = runPinga(["install", "--revert"], f12.env);
      expect(revCorrupt.exit).toBe(14);
      expect(treeHash(f12.home)).toEqual(treeAfterApply);

      unlinkSync(bPath);
      const revMissing = runPinga(["install", "--revert"], f12.env);
      expect(revMissing.exit).toBe(14);
      expect(treeHash(f12.home)).toEqual(treeAfterApply);
    } finally {
      cleanupFakeEnv(f12);
    }
  });

  test("13 & 14. T5 homônima (exit 11) e JSON inválido / version != 2 (exit 12)", () => {
    // 13a. enabledPlugins[PLUGIN_KEY] = false já em settings.json
    const f13a = makeRealisticHome();
    try {
      const settingsPath = join(f13a.home, ".claude/settings.json");
      const s = JSON.parse(readFileSync(settingsPath, "utf8"));
      s.enabledPlugins[PLUGIN_KEY] = false;
      writeFileSync(settingsPath, JSON.stringify(s, null, 2) + "\n");
      const beforeTree = treeHash(f13a.home);

      const d = runPinga(["install", "--dry-run"], f13a.env);
      expect(d.exit).toBe(11);
      expect(d.stderr).toContain(".claude/settings.json");
      expect(d.stderr).toContain(`/enabledPlugins/${PLUGIN_KEY}`);

      const a = runPinga(["install", "--apply"], f13a.env);
      expect(a.exit).toBe(11);
      expect(treeHash(f13a.home)).toEqual(beforeTree);
      expect(existsSync(defaultManifestPath(f13a.env))).toBe(false);
    } finally {
      cleanupFakeEnv(f13a);
    }

    // 13b. Variante do drift real: installed_plugins.json com plugins[PLUGIN_KEY] local
    const f13b = makeRealisticHome();
    try {
      const ipPath = join(f13b.home, ".claude/plugins/installed_plugins.json");
      const ip = JSON.parse(readFileSync(ipPath, "utf8"));
      ip.plugins[PLUGIN_KEY] = [
        {
          scope: "local",
          projectPath: "/p",
          installPath: "/p",
          version: "local",
          installedAt: NOW,
          lastUpdated: NOW,
        },
      ];
      writeFileSync(ipPath, JSON.stringify(ip, null, 2) + "\n");
      expect(runPinga(["install", "--dry-run"], f13b.env).exit).toBe(11);
    } finally {
      cleanupFakeEnv(f13b);
    }

    // 14a. settings.json inválido -> exit 12
    const f14a = makeRealisticHome();
    try {
      writeFileSync(join(f14a.home, ".claude/settings.json"), '{ "theme": ');
      const beforeTree = treeHash(f14a.home);
      const d = runPinga(["install", "--dry-run"], f14a.env);
      expect(d.exit).toBe(12);
      expect(d.stderr).toContain(".claude/settings.json");
      expect(runPinga(["install", "--apply"], f14a.env).exit).toBe(12);
      expect(treeHash(f14a.home)).toEqual(beforeTree);
    } finally {
      cleanupFakeEnv(f14a);
    }

    // 14b. installed_plugins.json com version: 1 -> exit 12
    const f14b = makeRealisticHome();
    try {
      writeFileSync(
        join(f14b.home, ".claude/plugins/installed_plugins.json"),
        '{"version":1,"plugins":{}}\n',
      );
      expect(runPinga(["install", "--dry-run"], f14b.env).exit).toBe(12);
    } finally {
      cleanupFakeEnv(f14b);
    }
  });

  test("15–19. Adaptadores falsos, --manifest, --home, fonte inválida e CLI", async () => {
    // 15. Adaptadores falsos via installCmd
    const f15 = makeRealisticHome();
    try {
      const beforeTree = treeHash(f15.home);

      const rogueThemeAdapter: Adapter = {
        harness: "claude",
        targets: [".claude/settings.json"],
        owned: { ".claude/settings.json": [`/enabledPlugins/${PLUGIN_KEY}`] },
        volatile: {},
        apply(shadowHome) {
          const p = join(shadowHome, ".claude/settings.json");
          const j = JSON.parse(readFileSync(p, "utf8"));
          j.theme = "light";
          writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
        },
      };
      const code1 = await installCmd({
        mode: "dry-run",
        home: f15.home,
        adapters: [rogueThemeAdapter],
        env: f15.env,
      });
      expect(code1).toBe(11);

      const rogueBashrcAdapter: Adapter = {
        harness: "claude",
        targets: [".claude/settings.json"],
        owned: { ".claude/settings.json": [] },
        volatile: {},
        apply(shadowHome) {
          writeFileSync(join(shadowHome, ".bashrc"), "export PWN=1\n");
        },
      };
      const code2 = await installCmd({
        mode: "dry-run",
        home: f15.home,
        adapters: [rogueBashrcAdapter],
        env: f15.env,
      });
      expect(code2).toBe(11);

      const boomAdapter: Adapter = {
        harness: "claude",
        targets: [".claude/settings.json"],
        owned: {},
        volatile: {},
        apply() {
          throw new Error("boom");
        },
      };
      const code3 = await installCmd({
        mode: "dry-run",
        home: f15.home,
        adapters: [boomAdapter],
        env: f15.env,
      });
      expect(code3).toBe(8);

      expect(treeHash(f15.home)).toEqual(beforeTree);
      expect(shadowLeftovers(f15.tmpdir)).toEqual([]);
    } finally {
      cleanupFakeEnv(f15);
    }

    // 16. --manifest <tmp>/m.json
    const f16 = makeRealisticHome();
    const customDir = tmp("pinga-t12-custom-m-");
    try {
      const beforeTree = treeHash(f16.home);
      const customManifest = join(customDir, "m.json");
      expect(
        runPinga(
          ["install", "--dry-run", "--manifest", customManifest],
          f16.env,
        ).exit,
      ).toBe(0);
      expect(
        runPinga(["install", "--apply", "--manifest", customManifest], f16.env)
          .exit,
      ).toBe(0);
      expect(existsSync(customManifest)).toBe(true);
      expect(existsSync(join(customDir, "backups"))).toBe(true);
      expect(existsSync(defaultManifestPath(f16.env))).toBe(false);

      expect(
        runPinga(["install", "--revert", "--manifest", customManifest], f16.env)
          .exit,
      ).toBe(0);
      expect(treeHash(f16.home)).toEqual(beforeTree);
    } finally {
      cleanupFakeEnv(f16);
      rmSync(customDir, { recursive: true, force: true });
    }

    // 17. --home A com HOME=B
    const fA = makeRealisticHome();
    const fB = makeRealisticHome();
    try {
      const beforeB = treeHash(fB.home);
      expect(
        runPinga(["install", "--dry-run", "--home", fA.home], fB.env).exit,
      ).toBe(0);
      expect(
        runPinga(["install", "--apply", "--home", fA.home], fB.env).exit,
      ).toBe(0);
      expect(treeHash(fB.home)).toEqual(beforeB);
      const sA = JSON.parse(
        readFileSync(join(fA.home, ".claude/settings.json"), "utf8"),
      );
      expect(sA.enabledPlugins[PLUGIN_KEY]).toBe(true);
    } finally {
      cleanupFakeEnv(fA);
      cleanupFakeEnv(fB);
    }

    // 18. Fonte inválida
    const f18 = makeRealisticHome();
    const badSrc = tmp("pinga-t12-badsrc-");
    try {
      const beforeTree = treeHash(f18.home);
      const r18 = runPinga(["install", "--dry-run"], {
        ...f18.env,
        PINGA_PI_HARNESS_DIR: badSrc,
      });
      expect(r18.exit).toBe(2);
      expect(r18.stderr).toContain("fonte");
      expect(treeHash(f18.home)).toEqual(beforeTree);
    } finally {
      cleanupFakeEnv(f18);
      rmSync(badSrc, { recursive: true, force: true });
    }

    // 19. CLI: modos inválidos e USAGE
    const f19 = makeRealisticHome();
    try {
      expect(runPinga(["install"], f19.env).exit).toBe(2);
      expect(
        runPinga(["install", "--dry-run", "--apply"], f19.env).exit,
      ).toBe(2);
      expect(
        runPinga(["install", "--dry-run", "--home"], f19.env).exit,
      ).toBe(2);
      expect(
        runPinga(
          ["install", "--dry-run", "--home", join(f19.tmpdir, "nao-existe")],
          f19.env,
        ).exit,
      ).toBe(2);
      expect(
        runPinga(["install", "--dry-run", "--xpto"], f19.env).exit,
      ).toBe(2);
      const usage = runPinga([], f19.env);
      expect(usage.stderr + usage.stdout).toContain("pinga install");
    } finally {
      cleanupFakeEnv(f19);
    }
  });
});
