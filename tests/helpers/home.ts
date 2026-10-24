import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const BIN = join(ROOT, "bin/pinga.ts");

export const NOW = "2026-10-24T12:00:00.000Z";
export const PLUGIN_KEY = "pi-harness@pi-harness-local";

export function tmp(prefix: string): string {
  return mkdtempSync(join(realpathSync(tmpdir()), prefix));
}

export type FakeEnv = {
  home: string;
  state: string;
  tmpdir: string;
  source: string;
  env: Record<string, string>;
};

export function makeRealisticHome(opts?: { omit?: string[] }): FakeEnv {
  const home = tmp("pinga-t12-home-");
  const state = tmp("pinga-t12-state-");
  const td = tmp("pinga-t12-tmp-");
  const source = tmp("pinga-src-");
  const omitSet = new Set(opts?.omit ?? []);

  const files: Record<string, string> = {
    ".claude/settings.json":
      JSON.stringify(
        {
          theme: "dark",
          model: "opus",
          hooks: {
            Stop: [
              {
                hooks: [{ type: "command", command: "echo user-hook" }],
              },
            ],
          },
          enabledPlugins: { "other@mkt": true },
        },
        null,
        2,
      ) + "\n",
    ".claude/plugins/installed_plugins.json":
      JSON.stringify(
        {
          version: 2,
          plugins: {
            "other@mkt": [
              {
                scope: "user",
                installPath: "/x",
                version: "1.0.0",
                installedAt: "2026-01-01T00:00:00.000Z",
                lastUpdated: "2026-01-01T00:00:00.000Z",
                gitCommitSha: "abc",
              },
            ],
          },
        },
        null,
        2,
      ) + "\n",
    ".claude/plugins/known_marketplaces.json":
      JSON.stringify(
        {
          mkt: {
            source: { source: "github", repo: "o/r" },
            installLocation: "/y",
            lastUpdated: "2026-01-01T00:00:00.000Z",
          },
        },
        null,
        2,
      ) + "\n",
    ".claude/CLAUDE.md": "# notas do usuário\n",
  };

  for (const [rel, content] of Object.entries(files)) {
    if (omitSet.has(rel)) continue;
    const abs = join(home, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  // Fonte do plugin pi-harness
  mkdirSync(join(source, ".claude-plugin"), { recursive: true });
  writeFileSync(
    join(source, ".claude-plugin/marketplace.json"),
    JSON.stringify(
      {
        name: "pi-harness-local",
        owner: { name: "x" },
        plugins: [{ name: "pi-harness", source: "./claude-plugin" }],
      },
      null,
      2,
    ) + "\n",
  );
  mkdirSync(join(source, "claude-plugin/hooks"), { recursive: true });
  writeFileSync(join(source, "claude-plugin/hooks/x.ts"), "// hook\n");

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    XDG_STATE_HOME: state,
    TMPDIR: td,
    PINGA_PI_HARNESS_DIR: source,
    PINGA_NOW: NOW,
  };

  return { home, state, tmpdir: td, source, env };
}

export function treeHash(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries: string[] = [];

  function walk(curr: string) {
    for (const name of readdirSync(curr)) {
      const abs = join(curr, name);
      const rel = relative(dir, abs).replace(/\\/g, "/");
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) {
        entries.push(`${rel} -> ${readlinkSync(abs)}`);
      } else if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile()) {
        const sha = createHash("sha256")
          .update(readFileSync(abs))
          .digest("hex");
        entries.push(`${rel} ${sha}`);
      }
    }
  }

  walk(dir);
  return entries.sort();
}

export function runPinga(
  args: string[],
  env: Record<string, string>,
): { exit: number; stdout: string; stderr: string } {
  const realTmp = realpathSync(tmpdir());
  for (const key of ["HOME", "XDG_STATE_HOME", "TMPDIR"] as const) {
    const val = env[key];
    if (!val || !val.startsWith(realTmp)) {
      throw new Error(
        `I16 violation: ${key}=${String(val)} must start with ${realTmp}`,
      );
    }
  }

  const childEnv: Record<string, string> = { ...env };
  delete childEnv.XDG_CONFIG_HOME;
  delete childEnv.XDG_DATA_HOME;
  delete childEnv.PI_CODING_AGENT_DIR;

  const res = Bun.spawnSync(["bun", BIN, ...args], {
    cwd: ROOT,
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exit: res.exitCode ?? 1,
    stdout: res.stdout.toString(),
    stderr: res.stderr.toString(),
  };
}

export function shadowLeftovers(td: string): string[] {
  if (!existsSync(td)) return [];
  return readdirSync(td)
    .filter((name) => name.startsWith("pinga-shadow-"))
    .sort();
}
