import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Adapter, AdapterContext } from "../install";

export const CLAUDE_MARKETPLACE = "pi-harness-local";
export const CLAUDE_PLUGIN_KEY = "pi-harness@pi-harness-local";

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function readJsonObject(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function configInvalid(message: string): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = "config_invalid";
  return err;
}

export const claudeAdapter: Adapter = {
  harness: "claude",

  targets: [
    ".claude/plugins/known_marketplaces.json",
    ".claude/plugins/installed_plugins.json",
    ".claude/settings.json",
  ],

  owned: {
    ".claude/plugins/known_marketplaces.json": ["/pi-harness-local"],
    ".claude/plugins/installed_plugins.json": [
      "/plugins/pi-harness@pi-harness-local",
    ],
    ".claude/settings.json": [
      "/enabledPlugins/pi-harness@pi-harness-local",
    ],
  },

  volatile: {
    ".claude/plugins/known_marketplaces.json": [
      "/pi-harness-local/lastUpdated",
    ],
    ".claude/plugins/installed_plugins.json": [
      "/plugins/pi-harness@pi-harness-local/0/installedAt",
      "/plugins/pi-harness@pi-harness-local/0/lastUpdated",
    ],
    ".claude/settings.json": [],
  },

  apply(shadowHome: string, ctx: AdapterContext): void {
    // 1. known_marketplaces.json (ausente -> criado em cima de {})
    const mktPath = join(shadowHome, ".claude/plugins/known_marketplaces.json");
    const mkt = readJsonObject(mktPath);
    mkt[CLAUDE_MARKETPLACE] = {
      source: { source: "directory", path: ctx.source },
      installLocation: ctx.source,
      lastUpdated: ctx.now,
    };
    writeJson(mktPath, mkt);

    // 2. installed_plugins.json (version != 2 -> config_invalid; exit 12)
    const ipPath = join(shadowHome, ".claude/plugins/installed_plugins.json");
    let ip: Record<string, unknown>;
    if (existsSync(ipPath)) {
      ip = JSON.parse(readFileSync(ipPath, "utf8")) as Record<string, unknown>;
      if (ip.version !== 2) {
        throw configInvalid(
          `.claude/plugins/installed_plugins.json: version != 2 (config_invalid)`,
        );
      }
    } else {
      ip = { version: 2, plugins: {} };
    }
    if (
      ip.plugins === null ||
      typeof ip.plugins !== "object" ||
      Array.isArray(ip.plugins)
    ) {
      ip.plugins = {};
    }
    (ip.plugins as Record<string, unknown>)[CLAUDE_PLUGIN_KEY] = [
      {
        scope: "user",
        installPath: join(ctx.source, "claude-plugin"),
        version: "local",
        installedAt: ctx.now,
        lastUpdated: ctx.now,
      },
    ];
    writeJson(ipPath, ip);

    // 3. settings.json (ausente -> criado em cima de {})
    const settingsPath = join(shadowHome, ".claude/settings.json");
    const settings = readJsonObject(settingsPath);
    const plugins =
      settings.enabledPlugins === null ||
      typeof settings.enabledPlugins !== "object" ||
      Array.isArray(settings.enabledPlugins)
        ? {}
        : (settings.enabledPlugins as Record<string, unknown>);
    plugins[CLAUDE_PLUGIN_KEY] = true;
    settings.enabledPlugins = plugins;
    writeJson(settingsPath, settings);
  },
};
