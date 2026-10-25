import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ENTROPY_MIN_BITS,
  ENTROPY_MIN_LEN,
  EXCERPT_MAX,
  REDACT_KINDS,
  canary,
  canaryCheck,
  clip,
  loadDenylist,
  redact,
  redactExcerpt,
  shannonEntropy,
} from "../src/redact";
import { makeRealisticHome, runPinga, tmp } from "./helpers/home";

const ROOT = resolve(import.meta.dir, "..");
const FIXTURE_PATH = join(ROOT, "testdata/secrets/fake-token.txt");

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function cleanupFakeEnv(f: ReturnType<typeof makeRealisticHome>) {
  rmSync(f.home, { recursive: true, force: true });
  rmSync(f.state, { recursive: true, force: true });
  rmSync(f.tmpdir, { recursive: true, force: true });
  rmSync(f.source, { recursive: true, force: true });
}

describe("T14 — Redação de segredos e canário (D19 / I19) — tests/redact.test.ts", () => {
  test("1. shannonEntropy", () => {
    expect(REDACT_KINDS).toEqual([
      "anthropic",
      "github",
      "aws",
      "jwt",
      "private_key",
      "url_credentials",
      "denylist",
      "entropy",
    ]);
    expect(ENTROPY_MIN_BITS).toBe(4.0);
    expect(ENTROPY_MIN_LEN).toBe(24);
    expect(EXCERPT_MAX).toBe(300);

    expect(shannonEntropy("")).toBe(0);
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("ab")).toBe(1);
    expect(shannonEntropy("abcd")).toBe(2);

    const s24 = "Zq8vR2mX" + "7kLp4Wn9" + "Tb3Yc6Hd";
    expect(Math.abs(shannonEntropy(s24) - Math.log2(24))).toBeLessThan(1e-9);
  });

  test("2. Fixture testdata/secrets/fake-token.txt", () => {
    const raw = readFileSync(FIXTURE_PATH, "utf8");
    const res = redact(raw);

    const expectedLines = [
      "# fixture sintética (T14): nenhum valor aqui é credencial real",
      "ANTHROPIC_API_KEY=[REDACTED:anthropic]",
      "GITHUB_TOKEN=[REDACTED:github]",
      "aws_access_key_id = [REDACTED:aws]",
      "Authorization: Bearer [REDACTED:jwt]",
      "[REDACTED:private_key]",
      "remote = https://[REDACTED:url_credentials]@git.example.invalid/repo.git",
      "session_secret=[REDACTED:entropy]",
    ];
    expect(res.text).toBe(expectedLines.join("\n") + "\n");
    expect(res.findings.map((f) => [f.kind, f.line])).toEqual([
      ["anthropic", 2],
      ["github", 3],
      ["aws", 4],
      ["jwt", 5],
      ["private_key", 6],
      ["url_credentials", 9],
      ["entropy", 10],
    ]);

    expect(res.text.includes("FA" + "KE")).toBe(false);
    expect(res.text.includes("hun" + "ter2")).toBe(false);
    expect(res.text.includes("Zq" + "8v")).toBe(false);

    // Idempotente
    const again = redact(res.text);
    expect(again.text).toBe(res.text);
    expect(again.findings).toEqual([]);
  });

  test("3. Regex isolados e negativos", () => {
    const ant = "sk-ant-api03-" + "FAKE".repeat(10) + "-AAAA";
    expect(redact(ant).findings).toEqual([{ kind: "anthropic", line: 1 }]);

    const gh = "ghp_" + "FAKE".repeat(9);
    expect(redact(gh).findings).toEqual([{ kind: "github", line: 1 }]);

    const aws = "AKIA" + "FAKE".repeat(4);
    expect(redact(aws).findings).toEqual([{ kind: "aws", line: 1 }]);

    const jwt =
      "eyJhbGciOiJIUzI1NiJ9" +
      "." +
      "eyJzdWIiOiJmYWtlIn0" +
      "." +
      "ZmFrZS1zaWduYXR1cmU";
    expect(redact(jwt).findings).toEqual([{ kind: "jwt", line: 1 }]);

    const pk = [
      "-----BEGIN OPENSSH " + "PRIVATE KEY-----",
      "RkFLRS1QUklWQVRFLUtFWS1CT0RZ",
      "-----END OPENSSH " + "PRIVATE KEY-----",
    ].join("\n");
    expect(redact(pk).findings).toEqual([{ kind: "private_key", line: 1 }]);

    const urlCred =
      "https://deploy:" + "hunter2" + "@git.example.invalid/repo.git";
    expect(redact(urlCred).findings).toEqual([
      { kind: "url_credentials", line: 1 },
    ]);

    // Negativos
    const shortAnt = "sk-ant-" + "x".repeat(5);
    expect(redact(shortAnt).findings).toEqual([]);
    expect(redact("https://host.example/x").findings).toEqual([]);
  });

  test("4. Entropia, fronteira e isenções (hex 40/64, identificadores comuns)", () => {
    const s24 = "Zq8vR2mX" + "7kLp4Wn9" + "Tb3Yc6Hd";
    expect(redact(s24).text).toBe("[REDACTED:entropy]");
    expect(redact(s24.slice(0, 23)).text).toBe(s24.slice(0, 23));

    const sha1Hex = createHash("sha1").update("x").digest("hex");
    const sha256Hex = createHash("sha256").update("x").digest("hex");
    expect(redact(sha1Hex).findings).toEqual([]);
    expect(redact(sha256Hex).findings).toEqual([]);

    for (const safe of [
      "verificacao_de_integracao_continua",
      "-home-shibuka-Projetos-duh-homelab-pi-harness--worktrees-fix-0047",
      "claude-opus-5-5-20261001-preview",
      "550e8400-e29b-41d4-a716-446655440000",
    ]) {
      expect(redact(safe).findings).toEqual([]);
    }
  });

  test("5. Denylist e loadDenylist", () => {
    const d = tmp("pinga-t14-deny-");
    try {
      const secretVal = "hunter2" + "hunter2";
      const denyPath = join(d, "deny.txt");
      writeFileSync(
        denyPath,
        `# comentário\n\n${sha256hex(secretVal)}\n`,
      );
      const set = loadDenylist(denyPath);
      expect(set.size).toBe(1);

      const r1 = redact(`senha=${secretVal} fim`, { denylist: set });
      expect(r1.text).toBe("senha=[REDACTED:denylist] fim");
      expect(r1.findings).toEqual([{ kind: "denylist", line: 1 }]);

      const r2 = redact(`senha=${secretVal} fim`);
      expect(r2.text).toBe(`senha=${secretVal} fim`);

      const badPath = join(d, "bad.txt");
      writeFileSync(badPath, "xyz\n");
      expect(() => loadDenylist(badPath)).toThrow();
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("6. Canário: canary() e canaryCheck()", () => {
    const c = canary();
    expect(c.length).toBe(7);
    expect(canaryCheck()).toEqual({ ok: true });

    const lowEntropy = "hunter2" + "hunter2";
    expect(canaryCheck([lowEntropy])).toEqual({ ok: false, survivors: 1 });

    const denySet = new Set([sha256hex(lowEntropy)]);
    expect(canaryCheck([lowEntropy], { denylist: denySet })).toEqual({
      ok: true,
    });
  });

  test("7. Ordem redigir -> cortar em redactExcerpt e clip", () => {
    expect(clip("abcdef", 3)).toBe("abc");
    const gh = "ghp_" + "FAKE".repeat(9);
    const prefix = "a".repeat(290);
    const longText = prefix + gh + " fim";
    expect(longText.length).toBeGreaterThan(300);

    const out = redactExcerpt(longText);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(300);
    expect(out!.includes("ghp_")).toBe(false);

    expect(redactExcerpt("")).toBeNull();
    expect(redactExcerpt(null)).toBeNull();
  });

  test("8 & 9. CLI pinga learn scan e AC-SEC em git ls-files do repo", () => {
    const f = makeRealisticHome();
    try {
      // 8. learn scan na fixture -> exit 1 e 7 linhas
      const s1 = runPinga(
        ["learn", "scan", "testdata/secrets/fake-token.txt"],
        f.env,
      );
      expect(s1.exit).toBe(1);
      expect(s1.stdout.trim().split("\n")).toEqual([
        "testdata/secrets/fake-token.txt:2: anthropic",
        "testdata/secrets/fake-token.txt:3: github",
        "testdata/secrets/fake-token.txt:4: aws",
        "testdata/secrets/fake-token.txt:5: jwt",
        "testdata/secrets/fake-token.txt:6: private_key",
        "testdata/secrets/fake-token.txt:9: url_credentials",
        "testdata/secrets/fake-token.txt:10: entropy",
      ]);
      expect(s1.stdout.includes("FA" + "KE")).toBe(false);
      expect(s1.stdout.includes("hun" + "ter2")).toBe(false);

      // Com --allow -> exit 0, stdout vazio
      const sAllow = runPinga(
        [
          "learn",
          "scan",
          "--allow",
          "testdata/secrets/fake-token.txt",
          "testdata/secrets/fake-token.txt",
        ],
        f.env,
      );
      expect(sAllow.exit).toBe(0);
      expect(sAllow.stdout).toBe("");

      // Arquivo limpo -> 0
      const cleanFile = join(f.tmpdir, "clean.txt");
      writeFileSync(cleanFile, "apenas texto normal\n");
      expect(runPinga(["learn", "scan", cleanFile], f.env).exit).toBe(0);

      // Inexistente -> 8
      expect(
        runPinga(["learn", "scan", join(f.tmpdir, "nao-existe.txt")], f.env)
          .exit,
      ).toBe(8);

      // Arquivo binário com NUL -> 0
      const binFile = join(f.tmpdir, "bin.dat");
      const gh = "ghp_" + "FAKE".repeat(9);
      writeFileSync(binFile, Buffer.from(`abc\0${gh}\n`, "utf8"));
      expect(runPinga(["learn", "scan", binFile], f.env).exit).toBe(0);

      // 9. AC-SEC: git ls-files do repo
      const ls = Bun.spawnSync(["git", "ls-files"], {
        cwd: ROOT,
        stdout: "pipe",
      });
      const files = ls.stdout
        .toString()
        .trim()
        .split("\n")
        .filter((x) => x.length > 0);
      const sec = runPinga(
        [
          "learn",
          "scan",
          "--allow",
          "testdata/secrets/fake-token.txt",
          ...files,
        ],
        f.env,
      );
      expect(sec.exit).toBe(0);
      expect(sec.stdout).toBe("");
    } finally {
      cleanupFakeEnv(f);
    }
  });
});
