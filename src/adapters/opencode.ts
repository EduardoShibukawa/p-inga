import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Adapter, Probe } from "../install";

export const OPENCODE_HEADER = "// gerado por pinga (T13): não editar";

export const OPENCODE_TARGET = ".config/opencode/plugins/pi-harness.ts";

/** Nomes de dirs `<source>/.pi/skills/NAME` com SKILL.md, em ordem. */
function skillsOf(source: string): string[] {
  try {
    const dir = join(source, ".pi/skills");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => existsSync(join(dir, name, "SKILL.md")))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Bytes são função só de `source` (determinístico). Sem skills, não escreve
 * nada — opencode.json nunca é alvo.
 */
export function opencodePluginBytes(source: string): string | null {
  const skills = skillsOf(source);
  if (skills.length === 0) return null;
  return [
    OPENCODE_HEADER,
    `// fonte: ${source}`,
    `export const SKILLS = ${JSON.stringify(skills)};`,
    "export const PiHarness = async () => ({});",
    "",
  ].join("\n");
}

/**
 * T48: `opencode plugin list` (v2) só mostra plugins com `tui.js`, e o nosso é
 * server-only. Confere o arquivo gerado no config dir que o opencode reporta.
 */
export const opencodeProbe: Probe = {
  check: "plugin_list",
  cmd: () => ["debug", "paths"],
  classify: (r: { exit: number; stdout: string }) => {
    if (r.exit !== 0) {
      return { status: "broken", detail: `debug paths exit ${r.exit}` };
    }
    const config = r.stdout.match(/^config\s+(.+)$/m)?.[1]?.trim();
    if (!config) return { status: "degraded", detail: "config dir ilegível" };
    const file = join(config, "plugins", "pi-harness.ts");
    let head = "";
    try {
      head = readFileSync(file, "utf8").split("\n", 1)[0] ?? "";
    } catch {
      return { status: "degraded", detail: "plugin pi-harness ausente" };
    }
    return head === OPENCODE_HEADER
      ? { status: "ok", detail: "plugin pi-harness gerado presente" }
      : { status: "degraded", detail: "plugin pi-harness sem cabeçalho do pinga" };
  },
};

export const opencodeAdapter: Adapter = {
  harness: "opencode",
  bin: "opencode",
  targets: [OPENCODE_TARGET],
  owned: {},
  volatile: {},
  probes: [opencodeProbe],

  apply(shadowHome: string, ctx: AdapterContext): void {
    const bytes = opencodePluginBytes(ctx.source);
    if (bytes === null) return;
    const path = join(shadowHome, OPENCODE_TARGET);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  },
};
