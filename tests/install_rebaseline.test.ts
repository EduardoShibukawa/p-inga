import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Adapter, installCmd } from "../src/install";
import { defaultManifestPath, readManifest, sha256File, writeAtomic } from "../src/manifest";
import { makeRealisticHome } from "./helpers/home";

const T = ".claude/settings.json";
const noop: Adapter = { harness: "claude", targets: [T], owned: {}, volatile: {}, apply() {} };
const STALE = "0".repeat(64);

function seed() {
  const f = makeRealisticHome();
  const mp = defaultManifestPath(f.env);
  writeAtomic(mp, JSON.stringify({ version: 1, entries: [{
    harness: "claude", target_file: T, sha256_pre: STALE, sha256_post: STALE,
    installed_at: "2026-10-25T00:00:00.000Z", backup_path: join(f.home, "bak"),
  }] }, null, 2) + "\n");
  return { f, mp };
}
const run = (f: ReturnType<typeof makeRealisticHome>, mode: string, adapters = [noop]) =>
  installCmd({ mode: mode as never, home: f.home, adapters, env: f.env });

describe("T47 — install --rebaseline", () => {
  test("diff vazio: atualiza sha256_post e não toca o alvo", async () => {
    const { f, mp } = seed();
    const before = readFileSync(join(f.home, T), "utf8");
    expect(await run(f, "dry-run")).toBe(0);
    expect(await run(f, "rebaseline")).toBe(0);
    expect(readManifest(mp).entries[0].sha256_post).toBe(sha256File(join(f.home, T)));
    expect(readFileSync(join(f.home, T), "utf8")).toBe(before);
  });
  test("sem dry-run prévio: recusa e manifesto intacto", async () => {
    const { f, mp } = seed();
    expect(await run(f, "rebaseline")).not.toBe(0);
    expect(readManifest(mp).entries[0].sha256_post).toBe(STALE);
  });
  test("diff não vazio: recusa e manifesto intacto", async () => {
    const { f, mp } = seed();
    const writer: Adapter = { ...noop, owned: { [T]: ["/pinga_t47"] }, apply(h) {
      const p = join(h, T); const j = JSON.parse(readFileSync(p, "utf8")); j.pinga_t47 = 1;
      writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
    } };
    expect(await run(f, "dry-run", [writer])).toBe(0);
    expect(await run(f, "rebaseline", [writer])).not.toBe(0);
    expect(readManifest(mp).entries[0].sha256_post).toBe(STALE);
  });
});
