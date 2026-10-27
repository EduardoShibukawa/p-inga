import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermesAdapter } from "../src/adapters/hermes";

function setup(config?: string) {
  const root = mkdtempSync(join(tmpdir(), "pinga-hermes-enable-"));
  const shadow = join(root, "shadow");
  const bin = join(root, "bin");
  const source = join(root, "pi-harness");
  for (const d of [join(shadow, ".hermes"), bin, join(source, "hermes-plugin")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(source, "hermes-plugin/plugin.yaml"), "name: pi-harness\n");
  if (config !== undefined) writeFileSync(join(shadow, ".hermes/config.yaml"), config);
  writeFileSync(join(bin, "hermes"), `#!/bin/sh\n[ "$1 $2" = "plugins enable" ] && exit 1\nexit 0\n`);
  chmodSync(join(bin, "hermes"), 0o755);
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: shadow };
  const cfg = () => readFileSync(join(shadow, ".hermes/config.yaml"), "utf8");
  return { shadow, source, env, cfg };
}
const ctxOf = (source: string) => ({ source, now: "2026-01-01T00:00:00Z" });
const enabled = (txt: string) => (Bun.YAML.parse(txt) as any)?.plugins?.enabled as string[];

describe("T45 hermes fonte local habilita via config.yaml", () => {
  test("não chama hermes plugins enable; adiciona à lista preservando o resto", () => {
    const s = setup("model: x\nplugins:\n  enabled:\n    - herdr-agent-state\n    - pinga-harness\nhooks: {}\n");
    expect(() => hermesAdapter.apply(s.shadow, ctxOf(s.source), s.env)).not.toThrow();
    const doc = Bun.YAML.parse(s.cfg()) as any;
    expect(doc.model).toBe("x");
    expect(doc.hooks).toEqual({});
    expect(enabled(s.cfg()).sort()).toEqual(["herdr-agent-state", "pi-harness", "pinga-harness"]);
  });

  test("idempotente: não duplica", () => {
    const s = setup("plugins:\n  enabled:\n    - pi-harness\n");
    hermesAdapter.apply(s.shadow, ctxOf(s.source), s.env);
    const once = s.cfg();
    hermesAdapter.apply(s.shadow, ctxOf(s.source), s.env);
    expect(s.cfg()).toBe(once);
    expect(enabled(once)).toEqual(["pi-harness"]);
  });

  test("cria config/chaves ausentes", () => {
    const s = setup();
    hermesAdapter.apply(s.shadow, ctxOf(s.source), s.env);
    expect(enabled(s.cfg())).toEqual(["pi-harness"]);
    const t = setup("model: y\n");
    hermesAdapter.apply(t.shadow, ctxOf(t.source), t.env);
    expect(enabled(t.cfg())).toEqual(["pi-harness"]);
    expect((Bun.YAML.parse(t.cfg()) as any).model).toBe("y");
  });

  test("plugins sem enabled e enabled vazio []", () => {
    const s = setup("plugins:\n  disabled: []\n");
    hermesAdapter.apply(s.shadow, ctxOf(s.source), s.env);
    expect(enabled(s.cfg())).toEqual(["pi-harness"]);
    const t = setup("plugins:\n  enabled: []\n");
    hermesAdapter.apply(t.shadow, ctxOf(t.source), t.env);
    expect(enabled(t.cfg())).toEqual(["pi-harness"]);
  });
});
