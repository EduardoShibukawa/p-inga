import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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

export const opencodeProbe: Probe = {
  check: "plugin_list",
  cmd: () => ["plugin", "list"],
  classify: (r: { exit: number; stdout: string }) => {
    if (r.exit !== 0) {
      return { status: "broken", detail: `plugin list exit ${r.exit}` };
    }
    const has = r.stdout
      .split(/\r?\n/)
      .some((l) => l.includes("pi-harness"));
    return has
      ? { status: "ok", detail: "plugin pi-harness listado" }
      : { status: "degraded", detail: "plugin pi-harness ausente" };
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
