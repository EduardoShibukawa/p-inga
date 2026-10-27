import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { type FakeEnv, makeRealisticHome, tmp } from "./home";

export const STUB_NAMES = [
  "claude",
  "pi-harness",
  "opencode",
  "hermes",
  "tuios",
] as const;
export type StubName = (typeof STUB_NAMES)[number];

const DEFAULT_BODIES: Record<StubName, string> = {
  "pi-harness": `
const fs = require("node:fs");
const path = require("node:path");
if (args[0] === "global" && args[1] === "install") {
  const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME, ".pi/agent");
  const srcDir = process.env.PINGA_PI_HARNESS_DIR;
  const skillsDir = path.join(agentDir, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });
  for (const s of ["sdlc-task-executor", "spec-authoring"]) {
    const dest = path.join(skillsDir, s);
    const target = path.join(srcDir, ".pi/skills", s);
    try { fs.unlinkSync(dest); } catch {}
    fs.symlinkSync(target, dest);
  }
  process.exit(0);
}
if (args[0] === "global" && args[1] === "status" && args[2] === "--json") {
  process.stdout.write(JSON.stringify({ installed: true }) + "\\n");
  process.exit(0);
}
process.exit(1);
`,
  hermes: `
const fs = require("node:fs");
const path = require("node:path");
if (args[0] === "plugins" && args[1] === "install") {
  const dir = path.join(process.env.HOME, ".hermes/plugins/pi-harness");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin.yaml"), "name: pi-harness\\n");
  process.exit(0);
}
if (args[0] === "plugins" && args[1] === "enable" && args[2] === "pi-harness") {
  const cfgPath = path.join(process.env.HOME, ".hermes/config.yaml");
  let parsed = { model: "qwen", plugins: { enabled: [] } };
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, "utf8");
    const y = Bun.YAML.parse(raw);
    if (y && typeof y === "object") parsed = y;
  }
  if (!parsed.plugins) parsed.plugins = { enabled: [] };
  if (!Array.isArray(parsed.plugins.enabled)) parsed.plugins.enabled = [];
  if (!parsed.plugins.enabled.includes("pi-harness")) {
    parsed.plugins.enabled.push("pi-harness");
  }
  const lines = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (k === "plugins") {
      lines.push("plugins:");
      if (v.enabled.length === 0) {
        lines.push("  enabled: []");
      } else {
        lines.push("  enabled:");
        for (const item of v.enabled) {
          lines.push("    - " + item);
        }
      }
    } else {
      lines.push(k + ": " + String(v));
    }
  }
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, lines.join("\\n") + "\\n");
  process.exit(0);
}
if (args[0] === "plugins" && args[1] === "list") {
  process.stdout.write("pi-harness  enabled\\n");
  process.exit(0);
}
if (args[0] === "doctor") {
  process.stdout.write("all checks passed\\n");
  process.exit(0);
}
process.exit(1);
`,
  tuios: `
const fs = require("node:fs");
const path = require("node:path");
if (args[0] === "integration" && args[1] === "install") {
  const settingsPath = path.join(process.env.HOME, ".claude/settings.json");
  const bakPath = settingsPath + ".tuios.bak";
  if (fs.existsSync(settingsPath)) {
    if (!fs.existsSync(bakPath)) {
      fs.writeFileSync(bakPath, fs.readFileSync(settingsPath));
    }
    const obj = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    if (!obj.hooks) obj.hooks = {};
    if (!Array.isArray(obj.hooks.Stop)) obj.hooks.Stop = [];
    const cmd = "tuios hook claude-code";
    const already = obj.hooks.Stop.some(
      (entry) => Array.isArray(entry.hooks) && entry.hooks.some((h) => h.command === cmd)
    );
    if (!already) {
      obj.hooks.Stop.push({
        hooks: [{ type: "command", command: cmd }],
      });
    }
    fs.writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + "\\n");
  }
  process.exit(0);
}
if (args[0] === "integration" && args[1] === "status") {
  process.stdout.write("claude-code installed\\nopencode current\\npi installed\\nhermes installed\\n");
  process.exit(0);
}
process.exit(1);
`,
  claude: `
if (args[0] === "plugin" && args[1] === "list") {
  process.stdout.write("pi-harness@pi-harness-local\\n  Scope: user\\n  Status: ✔ enabled\\n");
  process.exit(0);
}
if (args[0] === "plugin" && args[1] === "validate") {
  process.stdout.write("✔ Validation passed\\n");
  process.exit(0);
}
process.exit(1);
`,
  opencode: `
if (args[0] === "debug" && args[1] === "paths") {
  process.stdout.write("home       " + process.env.HOME + "\\nconfig     " + process.env.HOME + "/.config/opencode\\n");
  process.exit(0);
}
if (args[0] === "plugin" && args[1] === "list") {
  process.stdout.write("pi-harness\\nherdr-opencode\\n");
  process.exit(0);
}
process.exit(1);
`,
};

export function writeStubs(
  binDir: string,
  overrides?: Partial<Record<StubName, string>>,
): void {
  mkdirSync(binDir, { recursive: true });
  for (const name of STUB_NAMES) {
    const body = overrides?.[name] ?? DEFAULT_BODIES[name];
    const script = [
      `#!${process.execPath}`,
      `const args = process.argv.slice(2);`,
      `{`,
      `  const logPath = process.env.STUB_LOG;`,
      `  if (logPath) {`,
      `    require("node:fs").appendFileSync(logPath, JSON.stringify({ name: ${JSON.stringify(name)}, home: process.env.HOME || "", args }) + "\\n");`,
      `  }`,
      `}`,
      body,
    ].join("\n");
    const filePath = join(binDir, name);
    writeFileSync(filePath, script);
    chmodSync(filePath, 0o755);
  }
}

export function readStubLog(
  logPath: string,
): Array<{ name: StubName; home: string; args: string[] }> {
  if (!existsSync(logPath)) return [];
  const raw = readFileSync(logPath, "utf8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

export function makeHarnessHome(): FakeEnv & { bin: string; log: string } {
  const base = makeRealisticHome();
  const bin = tmp("pinga-t13-bin-");
  const log = join(base.tmpdir, "stub.log");

  // Acrescenta ao HOME da T12:
  const opencodeJson = join(base.home, ".config/opencode/opencode.json");
  mkdirSync(dirname(opencodeJson), { recursive: true });
  writeFileSync(
    opencodeJson,
    JSON.stringify({ plugins: ["github:EduardoShibukawa/G-Inga"] }, null, 2) +
      "\n",
  );

  const hermesCfg = join(base.home, ".hermes/config.yaml");
  mkdirSync(dirname(hermesCfg), { recursive: true });
  writeFileSync(hermesCfg, "model: qwen\nplugins:\n  enabled: []\n");

  const piSettings = join(base.home, ".pi/agent/settings.json");
  mkdirSync(dirname(piSettings), { recursive: true });
  writeFileSync(
    piSettings,
    JSON.stringify({ defaultModel: "qwen3.8-flash" }, null, 2) + "\n",
  );

  // Acrescenta à fonte: .pi/skills/{sdlc-task-executor,spec-authoring}/SKILL.md
  for (const s of ["sdlc-task-executor", "spec-authoring"]) {
    const skillFile = join(base.source, ".pi/skills", s, "SKILL.md");
    mkdirSync(dirname(skillFile), { recursive: true });
    writeFileSync(skillFile, `---\nname: ${s}\n---\n`);
  }

  // Fonte local: o adapter hermes linka <source>/hermes-plugin (T44).
  const hermesPlugin = join(base.source, "hermes-plugin/plugin.yaml");
  mkdirSync(dirname(hermesPlugin), { recursive: true });
  writeFileSync(hermesPlugin, "name: pi-harness\n");

  writeStubs(bin);

  // Garante um PATH com bin + diretórios de sistema sem harnesses reais
  const sysDirs = ["/usr/bin", "/bin"].filter((d) => {
    for (const h of STUB_NAMES) {
      if (Bun.which(h, { PATH: d })) return false;
    }
    return true;
  });
  const safePath = [
    bin,
    dirname(process.execPath),
    ...(sysDirs.length > 0 ? sysDirs : ["/usr/bin", "/bin"]),
  ].join(":");

  base.env.PATH = safePath;
  base.env.STUB_LOG = log;

  return { ...base, bin, log };
}
