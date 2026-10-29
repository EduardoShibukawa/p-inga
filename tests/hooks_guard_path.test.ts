import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NEW_FILE_GUARD_REASON,
  NEW_FILE_GUARD_REASON_RG,
  PAYLOAD_GUARD_REASON,
  PAYLOAD_GUARD_REASON_RG,
  preToolPayloadGuard,
} from "../src/hooks";

// A6: sem config, o provider do guard segue o PATH (gira se achar, senão rg).
const ORIGINAL_PATH = process.env.PATH;
afterEach(() => {
  process.env.PATH = ORIGINAL_PATH;
});

function mkBin(dir: string, withGira: boolean): string {
  const bin = join(dir, withGira ? "bin-gira" : "bin-empty");
  mkdirSync(bin, { recursive: true });
  if (withGira) {
    const gira = join(bin, "gira");
    writeFileSync(gira, "#!/bin/sh\nexit 0\n");
    chmodSync(gira, 0o755);
  }
  return bin;
}

function overwrite(tmp: string) {
  writeFileSync(join(tmp, "existing.ts"), "export const short = 1;\n");
  return preToolPayloadGuard(
    "write_file",
    { path: "existing.ts", content: "x\n".repeat(101) },
    tmp
  );
}

function bigNew(tmp: string) {
  return preToolPayloadGuard(
    "write_file",
    { path: "new-file.ts", content: "x".repeat(2501) },
    tmp
  );
}

describe("A6 — guard sem config usa o fallback de PATH", () => {
  test("1. sem config e sem gira no PATH → dicas rg, sem citar gira", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pinga-a6-path-rg-"));
    try {
      process.env.PATH = mkBin(tmp, false);
      expect(overwrite(tmp).reason).toBe(PAYLOAD_GUARD_REASON_RG);
      expect(bigNew(tmp).reason).toBe(NEW_FILE_GUARD_REASON_RG);
      expect(PAYLOAD_GUARD_REASON_RG).not.toContain("gira");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("2. sem config e com gira no PATH → dicas gira atuais", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pinga-a6-path-gira-"));
    try {
      process.env.PATH = mkBin(tmp, true);
      expect(overwrite(tmp).reason).toBe(PAYLOAD_GUARD_REASON);
      expect(bigNew(tmp).reason).toBe(NEW_FILE_GUARD_REASON);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("3. config provider=gira vence o PATH sem gira", () => {
    const tmp = mkdtempSync(join(tmpdir(), "pinga-a6-path-cfg-"));
    try {
      mkdirSync(join(tmp, ".ginga"), { recursive: true });
      writeFileSync(join(tmp, ".ginga", "project.toml"), '[context]\nprovider = "gira"\n');
      process.env.PATH = mkBin(tmp, false);
      expect(overwrite(tmp).reason).toBe(PAYLOAD_GUARD_REASON);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
