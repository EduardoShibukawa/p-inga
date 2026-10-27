import { describe, expect, test } from "bun:test";
import { tuiosAdapter } from "../src/adapters/tuios";

// Mesma regra de src/install.ts matchesTarget.
const covered = (rel: string) =>
  tuiosAdapter.targets.some((t) => t === rel || (t.endsWith("/") && rel.startsWith(t)));

describe("T46 — alvos do tuios", () => {
  for (const rel of [
    ".agents/skills/tuios/SKILL.md",
    ".claude/skills/tuios/SKILL.md",
    ".config/opencode/plugins/tuios-agent-state.js",
    ".config/opencode/plugins/tuios-agent-state/index.js",
    ".config/opencode/plugins/tuios-agent-state/tui.js",
    ".hermes/plugins/tuios-agent-state/__init__.py",
    ".hermes/plugins/tuios-agent-state/plugin.yaml",
  ]) {
    test(`${rel} é alvo`, () => expect(covered(rel)).toBe(true));
  }
  test("não cobre skills de outros", () => expect(covered(".claude/skills/pinga/SKILL.md")).toBe(false));
});
