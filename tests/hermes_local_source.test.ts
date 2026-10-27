import { describe, expect, test } from "bun:test";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hermesAdapter } from "../src/adapters/hermes";

function setup() {
  const root = mkdtempSync(join(tmpdir(), "pinga-hermes-local-"));
  const shadow = join(root, "shadow");
  const bin = join(root, "bin");
  const source = join(root, "pi-harness");
  for (const d of [shadow, bin, join(source, "hermes-plugin")]) mkdirSync(d, { recursive: true });
  writeFileSync(join(source, "hermes-plugin/plugin.yaml"), "name: pi-harness\n");
  const log = join(root, "calls.log");
  writeFileSync(
    join(bin, "hermes"),
    `#!/bin/sh\necho "$@" >> '${log}'\n[ "$1 $2" = "plugins install" ] && exit 1\nexit 0\n`,
  );
  chmodSync(join(bin, "hermes"), 0o755);
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: shadow };
  return { root, shadow, source, log, env };
}

const ctxOf = (source: string) => ({ source, now: "2026-01-01T00:00:00Z" });

describe("T44 hermes adapter com fonte local", () => {
  test("cria symlink para <source>/hermes-plugin, não chama plugins install e habilita", () => {
    const s = setup();
    expect(() => hermesAdapter.apply(s.shadow, ctxOf(s.source), s.env)).not.toThrow();
    const link = join(s.shadow, ".hermes/plugins/pi-harness");
    expect(readlinkSync(link)).toBe(join(s.source, "hermes-plugin"));
    expect(existsSync(join(link, "plugin.yaml"))).toBe(true);
    const calls = existsSync(s.log) ? readFileSync(s.log, "utf8") : "";
    expect(calls).not.toContain("plugins install");
    expect(calls).not.toContain("plugins enable");
  });

  test("idempotente quando o symlink já aponta para o mesmo alvo", () => {
    const s = setup();
    mkdirSync(join(s.shadow, ".hermes/plugins"), { recursive: true });
    symlinkSync(join(s.source, "hermes-plugin"), join(s.shadow, ".hermes/plugins/pi-harness"));
    expect(() => hermesAdapter.apply(s.shadow, ctxOf(s.source), s.env)).not.toThrow();
  });

  test("falha claro quando o symlink aponta para outro alvo", () => {
    const s = setup();
    mkdirSync(join(s.shadow, ".hermes/plugins"), { recursive: true });
    symlinkSync(join(s.root, "outro"), join(s.shadow, ".hermes/plugins/pi-harness"));
    expect(() => hermesAdapter.apply(s.shadow, ctxOf(s.source), s.env)).toThrow(/aponta para/);
  });

  test("fonte não local (owner/repo) continua usando plugins install", () => {
    const s = setup();
    expect(() => hermesAdapter.apply(s.shadow, ctxOf("owner/pi-harness"), s.env)).toThrow(/plugins install/);
  });
});
