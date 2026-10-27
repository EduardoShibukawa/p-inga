import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { hermesAdapter } from "../src/adapters/hermes";
import { OPENCODE_HEADER, opencodeAdapter } from "../src/adapters/opencode";
import { piAdapter } from "../src/adapters/pi";
import { tuiosAdapter } from "../src/adapters/tuios";
import { ADAPTER_ORDER, runNative } from "../src/install";
import {
  defaultManifestPath,
  readManifest,
  sha256File,
  validateManifest,
  writeAtomic,
} from "../src/manifest";
import {
  PLUGIN_KEY,
  runPinga,
  shadowLeftovers,
  tmp,
  treeHash,
} from "./helpers/home";
import { makeHarnessHome, readStubLog, writeStubs } from "./helpers/stubs";

function sha256hex(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

function cleanupHarnessEnv(h: ReturnType<typeof makeHarnessHome>) {
  rmSync(h.home, { recursive: true, force: true });
  rmSync(h.state, { recursive: true, force: true });
  rmSync(h.tmpdir, { recursive: true, force: true });
  rmSync(h.source, { recursive: true, force: true });
  rmSync(h.bin, { recursive: true, force: true });
}

describe("T13 — Adaptadores pi, opencode, Hermes e TUIOS (I16 / I17) — tests/adapters.test.ts", () => {
  test("1. sha256File de symlink e writeAtomic(p, { symlink: 'x' })", () => {
    expect(ADAPTER_ORDER).toEqual([
      "pi",
      "claude",
      "opencode",
      "hermes",
      "tuios",
    ]);
    expect(OPENCODE_HEADER).toBe("// gerado por pinga (T13): não editar");
    expect(piAdapter.harness).toBe("pi");
    expect(opencodeAdapter.harness).toBe("opencode");
    expect(hermesAdapter.harness).toBe("hermes");
    expect(tuiosAdapter.harness).toBe("tuios");

    const d = tmp("pinga-t13-sym-");
    try {
      const symPath = join(d, "sub/link");
      writeAtomic(symPath, { symlink: "x" });
      expect(lstatSync(symPath).isSymbolicLink()).toBe(true);
      expect(readlinkSync(symPath)).toBe("x");
      expect(readdirSync(join(d, "sub"))).toEqual(["link"]);
      expect(sha256File(symPath)).toBe(sha256hex("symlink:x"));
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("2–5. Dry-run completo (5 harnesses em ordem), apply, idempotência e revert", () => {
    const h = makeHarnessHome();
    try {
      const beforeTree = treeHash(h.home);
      const beforeOpencodeJson = readFileSync(
        join(h.home, ".config/opencode/opencode.json"),
        "utf8",
      );
      const beforePiSettings = readFileSync(
        join(h.home, ".pi/agent/settings.json"),
        "utf8",
      );
      const beforeClaudeSettings = JSON.parse(
        readFileSync(join(h.home, ".claude/settings.json"), "utf8"),
      );

      // 2. Dry-run completo
      const dry = runPinga(["install", "--dry-run"], h.env);
      expect(dry.exit).toBe(0);
      const idxPi = dry.stdout.indexOf("=== pi ===");
      const idxClaude = dry.stdout.indexOf("=== claude ===");
      const idxOpencode = dry.stdout.indexOf("=== opencode ===");
      const idxHermes = dry.stdout.indexOf("=== hermes ===");
      const idxTuios = dry.stdout.indexOf("=== tuios ===");
      expect(idxPi).toBeGreaterThanOrEqual(0);
      expect(idxClaude).toBeGreaterThan(idxPi);
      expect(idxOpencode).toBeGreaterThan(idxClaude);
      expect(idxHermes).toBeGreaterThan(idxOpencode);
      expect(idxTuios).toBeGreaterThan(idxHermes);

      expect(treeHash(h.home)).toEqual(beforeTree);
      const logsDry = readStubLog(h.log);
      expect(logsDry.length).toBeGreaterThan(0);
      for (const entry of logsDry) {
        expect(entry.home).not.toBe(h.home);
        expect(entry.home.startsWith(join(h.tmpdir, "pinga-shadow-"))).toBe(
          true,
        );
        expect(existsSync(entry.home)).toBe(false);
      }
      expect(shadowLeftovers(h.tmpdir)).toEqual([]);

      // 3. Apply
      const app = runPinga(["install", "--apply"], h.env);
      expect(app.exit).toBe(0);

      // pi symlinks
      const specLink = join(h.home, ".pi/agent/skills/spec-authoring");
      expect(lstatSync(specLink).isSymbolicLink()).toBe(true);
      expect(readlinkSync(specLink)).toBe(
        join(h.source, ".pi/skills/spec-authoring"),
      );

      // opencode plugin
      const ocPlugin = readFileSync(
        join(h.home, ".config/opencode/plugins/pi-harness.ts"),
        "utf8",
      );
      expect(ocPlugin.startsWith(OPENCODE_HEADER)).toBe(true);
      expect(ocPlugin).toContain(
        'export const SKILLS = ["sdlc-task-executor","spec-authoring"]',
      );
      expect(
        readFileSync(join(h.home, ".config/opencode/opencode.json"), "utf8"),
      ).toBe(beforeOpencodeJson);
      expect(
        readFileSync(join(h.home, ".pi/agent/settings.json"), "utf8"),
      ).toBe(beforePiSettings);

      // hermes
      expect(
        existsSync(join(h.home, ".hermes/plugins/pi-harness/plugin.yaml")),
      ).toBe(true);
      const hermesCfg = Bun.YAML.parse(
        readFileSync(join(h.home, ".hermes/config.yaml"), "utf8"),
      ) as { model: string; plugins: { enabled: string[] } };
      expect(hermesCfg.model).toBe("qwen");
      expect(hermesCfg.plugins.enabled).toEqual(["pi-harness"]);

      // claude + tuios
      const afterClaudeSettings = JSON.parse(
        readFileSync(join(h.home, ".claude/settings.json"), "utf8"),
      );
      expect(afterClaudeSettings.hooks.Stop[0]).toEqual(
        beforeClaudeSettings.hooks.Stop[0],
      );
      expect(afterClaudeSettings.hooks.Stop[1]).toEqual({
        hooks: [{ type: "command", command: "tuios hook claude-code" }],
      });
      expect(afterClaudeSettings.enabledPlugins[PLUGIN_KEY]).toBe(true);
      expect(
        existsSync(join(h.home, ".claude/settings.json.tuios.bak")),
      ).toBe(true);

      // manifest
      const mPath = defaultManifestPath(h.env);
      const m = readManifest(mPath);
      expect(validateManifest(m).ok).toBe(true);
      for (const name of ADAPTER_ORDER) {
        expect(m.entries.some((e) => e.harness === name)).toBe(true);
      }
      expect(
        m.entries.some(
          (e) =>
            e.harness === "tuios" &&
            e.target_file === ".claude/settings.json" &&
            e.key_path === "/hooks/Stop/1",
        ),
      ).toBe(true);

      for (const entry of readStubLog(h.log)) {
        expect(entry.home).not.toBe(h.home);
      }

      // 4. Idempotência
      const treeAfterApply = treeHash(h.home);
      const manifestAfterApply = readFileSync(mPath, "utf8");
      const dry2 = runPinga(["install", "--dry-run"], h.env);
      expect(dry2.exit).toBe(0);
      expect(dry2.stdout).toBe("");
      expect(treeHash(h.home)).toEqual(treeAfterApply);
      expect(readFileSync(mPath, "utf8")).toBe(manifestAfterApply);

      // 5. Revert
      const rev = runPinga(["install", "--revert"], h.env);
      expect(rev.exit).toBe(0);
      expect(treeHash(h.home)).toEqual(beforeTree);
    } finally {
      cleanupHarnessEnv(h);
    }
  });

  test("6 & 7. --only opencode, --only agy (exit 2) e binário ausente (hermes pulado)", () => {
    // 6. --only opencode
    const h6 = makeHarnessHome();
    try {
      const dry = runPinga(
        ["install", "--dry-run", "--only", "opencode"],
        h6.env,
      );
      expect(dry.exit).toBe(0);
      expect(dry.stdout.startsWith("=== opencode ===")).toBe(true);
      expect(dry.stdout).not.toContain("=== claude ===");

      const app = runPinga(
        ["install", "--apply", "--only", "opencode"],
        h6.env,
      );
      expect(app.exit).toBe(0);
      expect(
        existsSync(join(h6.home, ".config/opencode/plugins/pi-harness.ts")),
      ).toBe(true);
      const m = readManifest(defaultManifestPath(h6.env));
      expect(m.entries.every((e) => e.harness === "opencode")).toBe(true);
      expect(readStubLog(h6.log)).toEqual([]);

      expect(
        runPinga(["install", "--dry-run", "--only", "agy"], h6.env).exit,
      ).toBe(2);
    } finally {
      cleanupHarnessEnv(h6);
    }

    // 7. Binário ausente (sem hermes)
    const h7 = makeHarnessHome();
    try {
      unlinkSync(join(h7.bin, "hermes"));
      const dry = runPinga(["install", "--dry-run"], h7.env);
      expect(dry.exit).toBe(0);
      expect(dry.stdout).toContain("=== hermes (pulado: hermes ausente) ===");
      expect(dry.stdout).toContain("=== pi ===");
      expect(dry.stdout).toContain("=== claude ===");
      expect(dry.stdout).toContain("=== opencode ===");
      expect(dry.stdout).toContain("=== tuios ===");
    } finally {
      cleanupHarnessEnv(h7);
    }
  });

  test("8–13. Falhas e guardas: CLI nativo exit 3 (8), só-acréscimo violado (11), homônima arquivo (11), fora dos alvos (11), YAML inválido (12) e timeout (8)", () => {
    // 8. CLI nativo falha
    const h8 = makeHarnessHome();
    try {
      writeStubs(h8.bin, { "pi-harness": "process.exit(3);" });
      const before = treeHash(h8.home);
      const r = runPinga(["install", "--dry-run"], h8.env);
      expect(r.exit).toBe(8);
      expect(r.stderr).toContain("pi-harness");
      expect(treeHash(h8.home)).toEqual(before);
      expect(shadowLeftovers(h8.tmpdir)).toEqual([]);
    } finally {
      cleanupHarnessEnv(h8);
    }

    // 9. Só-acréscimo violado no tuios
    const h9 = makeHarnessHome();
    try {
      writeStubs(h9.bin, {
        tuios: `
const fs = require("node:fs");
const path = require("node:path");
const p = path.join(process.env.HOME, ".claude/settings.json");
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.hooks.Stop[0].hooks[0].command = "hacked";
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\\n");
process.exit(0);
`,
      });
      const r = runPinga(["install", "--dry-run"], h9.env);
      expect(r.exit).toBe(11);
      expect(r.stderr).toContain("/hooks/Stop/0/hooks/0/command");
    } finally {
      cleanupHarnessEnv(h9);
    }

    // 10. Homônima de arquivo (pi-harness.ts já existe)
    const h10 = makeHarnessHome();
    try {
      const p = join(h10.home, ".config/opencode/plugins/pi-harness.ts");
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, "// do usuário\n");
      const r = runPinga(["install", "--dry-run"], h10.env);
      expect(r.exit).toBe(11);
      expect(r.stderr).toContain(".config/opencode/plugins/pi-harness.ts");
    } finally {
      cleanupHarnessEnv(h10);
    }

    // 11. Fora dos alvos (.bashrc)
    const h11 = makeHarnessHome();
    try {
      writeStubs(h11.bin, {
        "pi-harness": `
const fs = require("node:fs");
const path = require("node:path");
fs.writeFileSync(path.join(process.env.HOME, ".bashrc"), "pwn\\n");
process.exit(0);
`,
      });
      const r = runPinga(["install", "--dry-run"], h11.env);
      expect(r.exit).toBe(11);
      expect(r.stderr).toContain("fora dos alvos: .bashrc");
    } finally {
      cleanupHarnessEnv(h11);
    }

    // 12. YAML inválido
    const h12 = makeHarnessHome();
    try {
      writeFileSync(join(h12.home, ".hermes/config.yaml"), "plugins: [\n");
      const r = runPinga(["install", "--dry-run"], h12.env);
      expect(r.exit).toBe(12);
      expect(r.stderr).toContain(".hermes/config.yaml");
    } finally {
      cleanupHarnessEnv(h12);
    }

    // 13. Timeout do nativo
    const h13 = makeHarnessHome();
    try {
      writeStubs(h13.bin, {
        tuios: "Bun.sleepSync(5000); process.exit(0);",
      });
      const r = runPinga(["install", "--dry-run"], {
        ...h13.env,
        PINGA_INSTALL_TIMEOUT_MS: "200",
      });
      expect(r.exit).toBe(8);
      expect(shadowLeftovers(h13.tmpdir)).toEqual([]);
    } finally {
      cleanupHarnessEnv(h13);
    }
  });
});
