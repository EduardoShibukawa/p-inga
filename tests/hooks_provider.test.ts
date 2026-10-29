import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NEW_FILE_GUARD_REASON,
  PAYLOAD_GUARD_REASON,
  contextProvider,
  preToolPayloadGuard,
} from "../src/hooks";
import { checkGiraStatus } from "../src/doctor";

// helpers deterministicas: provider vem SEMPRE de config/PATH explicitos, nunca do ambiente
function mkTmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeConfig(dir: string, provider: string): void {
  mkdirSync(join(dir, ".ginga"), { recursive: true });
  writeFileSync(join(dir, ".ginga", "project.toml"), `[context]\nprovider = "${provider}"\n`);
}

// PATH de um bin dir com um script executavel chamado "gira"
function pathWithFakeGira(dir: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const gira = join(bin, "gira");
  writeFileSync(gira, "#!/bin/sh\nexit 0\n");
  chmodSync(gira, 0o755);
  return bin;
}

// PATH sem nenhum "gira"
function pathWithoutGira(dir: string): string {
  const bin = join(dir, "emptybin");
  mkdirSync(bin, { recursive: true });
  return bin;
}

function payloadLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `export const line${i} = ${i};`).join("\n");
}

describe("A6 — provider de contexto (config → PATH → rg)", () => {
  test("1. [context].provider da config vence o PATH (rg)", () => {
    const tmp = mkTmp("pinga-a6-cfg-rg-");
    try {
      writeConfig(tmp, "rg");
      const env = { PATH: pathWithFakeGira(tmp) };
      expect(contextProvider(tmp, env)).toBe("rg");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("2. [context].provider da config vence o PATH (gira mesmo sem gira no PATH)", () => {
    const tmp = mkTmp("pinga-a6-cfg-gira-");
    try {
      writeConfig(tmp, "gira");
      expect(contextProvider(tmp, { PATH: pathWithoutGira(tmp) })).toBe("gira");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("3. sem config, gira no PATH → gira", () => {
    const tmp = mkTmp("pinga-a6-nopath-gira-");
    try {
      expect(contextProvider(tmp, { PATH: pathWithFakeGira(tmp) })).toBe("gira");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("4. sem config, sem gira no PATH → rg", () => {
    const tmp = mkTmp("pinga-a6-nopath-rag-");
    try {
      expect(contextProvider(tmp, { PATH: pathWithoutGira(tmp) })).toBe("rg");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("5. a config é procurada em diretório ancestral", () => {
    const tmp = mkTmp("pinga-a6-ancestor-");
    try {
      writeConfig(tmp, "rg");
      const deep = join(tmp, "pkg", "sub");
      mkdirSync(deep, { recursive: true });
      expect(contextProvider(deep, { PATH: pathWithFakeGira(tmp) })).toBe("rg");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("A6 — dicas de hook sem citar o gira quando o provider é rg", () => {
  test("6. payload guard: provider rg → dica 'edite só o símbolo alvo', sem gira", () => {
    const tmp = mkTmp("pinga-a6-guard-rg-");
    try {
      writeConfig(tmp, "rg");
      writeFileSync(join(tmp, "existing.ts"), "export const short = 1;\n");
      const res = preToolPayloadGuard(
        "write_file",
        { path: "existing.ts", content: payloadLines(101) },
        tmp
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toBeDefined();
      expect(res.reason).toContain("Guardrail G2");
      expect(res.reason).toContain("edite só o símbolo alvo");
      expect(res.reason).not.toContain("gira");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("7. payload guard: provider gira (config) → PAYLOAD_GUARD_REASON atual", () => {
    const tmp = mkTmp("pinga-a6-guard-gira-");
    try {
      writeConfig(tmp, "gira");
      writeFileSync(join(tmp, "existing.ts"), "export const short = 1;\n");
      const res = preToolPayloadGuard(
        "write_file",
        { path: "existing.ts", content: payloadLines(101) },
        tmp
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe(PAYLOAD_GUARD_REASON);
      expect(res.reason).toContain("gira write <file> <symbol>");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("8. payload guard: sem config → mensagem atual inalterada (compat)", () => {
    const tmp = mkTmp("pinga-a6-guard-none-");
    try {
      writeFileSync(join(tmp, "existing.ts"), "export const short = 1;\n");
      const res = preToolPayloadGuard(
        "write_file",
        { path: "existing.ts", content: payloadLines(101) },
        tmp
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe(PAYLOAD_GUARD_REASON);

      const big = { path: "new-file.ts", content: "x".repeat(2501) };
      const res2 = preToolPayloadGuard("write_file", big, tmp);
      expect(res2.allowed).toBe(false);
      expect(res2.reason).toBe(NEW_FILE_GUARD_REASON);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("9. new-file guard: provider rg → sem citar gira, mantém append_file", () => {
    const tmp = mkTmp("pinga-a6-newfile-rg-");
    try {
      writeConfig(tmp, "rg");
      const res = preToolPayloadGuard(
        "write_file",
        { path: "brand-new.ts", content: "x".repeat(2501) },
        tmp
      );
      expect(res.allowed).toBe(false);
      expect(res.reason).toBeDefined();
      expect(res.reason).toContain("Guardrail G2");
      expect(res.reason).toContain("append_file");
      expect(res.reason).not.toContain("gira");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("A6 — doctor: gira ausente com provider ≠ gira é ok (opcional)", () => {
  test("10. sem config + gira ausente no PATH → ok, mensagem diz opcional", () => {
    const tmp = mkTmp("pinga-a6-doc-rag-");
    try {
      const status = checkGiraStatus({ cwd: tmp, env: { PATH: pathWithoutGira(tmp) } });
      expect(status.ok).toBe(true);
      expect(status.message).toContain("opcional");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("11. config provider rg + gira ausente → ok, mensagem diz opcional", () => {
    const tmp = mkTmp("pinga-a6-doc-cfgrag-");
    try {
      writeConfig(tmp, "rg");
      const status = checkGiraStatus({ cwd: tmp, env: { PATH: pathWithoutGira(tmp) } });
      expect(status.ok).toBe(true);
      expect(status.message).toContain("opcional");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("12. config provider gira + gira ausente → falha (comportamento atual)", () => {
    const tmp = mkTmp("pinga-a6-doc-cfggira-");
    try {
      writeConfig(tmp, "gira");
      const status = checkGiraStatus({ cwd: tmp, env: { PATH: pathWithoutGira(tmp) } });
      expect(status.ok).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("13. gira presente sem .gira/macro-map.json → falha, mesmo com provider rg", () => {
    const tmp = mkTmp("pinga-a6-doc-present-");
    try {
      writeConfig(tmp, "rg");
      const status = checkGiraStatus({ cwd: tmp, env: { PATH: pathWithFakeGira(tmp) } });
      expect(status.ok).toBe(false);
      expect(status.message).toContain("macro-map");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("14. gira presente com macro-map → ok (comportamento atual)", () => {
    const tmp = mkTmp("pinga-a6-doc-map-");
    try {
      mkdirSync(join(tmp, ".gira"), { recursive: true });
      writeFileSync(join(tmp, ".gira", "macro-map.json"), "{}\n");
      const status = checkGiraStatus({ cwd: tmp, env: { PATH: pathWithFakeGira(tmp) } });
      expect(status.ok).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
