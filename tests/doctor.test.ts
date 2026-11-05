import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DOCTOR_STATUSES,
  type DoctorRecord,
  EMPTY_SHA256,
  finalizeRecord,
  law2For,
  runDoctor,
} from "../src/doctor";
import { defaultManifestPath } from "../src/manifest";
import { runPinga, tmp } from "./helpers/home";

function hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

type Home = { home: string; state: string; env: Record<string, string> };

function makeHome(): Home {
  const home = tmp("pinga-doctor-home-");
  const state = tmp("pinga-doctor-state-");
  const tmpdir = tmp("pinga-doctor-tmp-");
  mkdirSync(join(state, "pinga"), { recursive: true });
  return {
    home,
    state,
    env: {
      HOME: home,
      XDG_STATE_HOME: state,
      TMPDIR: tmpdir,
      PINGA_DOCTOR_TIMEOUT_MS: "5000",
    },
  };
}

function writeManifest(home: Home, targetFile: string, content: string): void {
  mkdirSync(join(home.home, targetFile, ".."), { recursive: true });
  writeFileSync(join(home.home, targetFile), content);
  const entry = {
    harness: "opencode",
    target_file: targetFile,
    sha256_pre: "absent",
    sha256_post: hex(content),
    installed_at: "2026-10-29T00:00:00.000Z",
    backup_path: "",
  };
  writeFileSync(
    defaultManifestPath(home.env),
    JSON.stringify({ version: 1, entries: [entry] }, null, 2) + "\n",
  );
}

function assertValidDoctorSchema(records: DoctorRecord[]) {
  const expectedKeys = [
    "harness",
    "check",
    "status",
    "law2",
    "cmd",
    "exit",
    "stdout_sha256",
    "duration_ms",
    "detail",
  ];
  for (const r of records) {
    expect(Object.keys(r)).toEqual(expectedKeys);
    expect(DOCTOR_STATUSES).toContain(r.status);
    expect(["pass", "fail", "blocked", "not run"]).toContain(r.law2);
    if (r.status === "ok") {
      expect(r.cmd).not.toBeNull();
      expect(r.exit).toBe(0);
      expect(r.stdout_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(r.stdout_sha256).not.toBe(EMPTY_SHA256);
    }
  }
}

async function withModelsServer(
  fn: (endpoint: string) => Promise<void>,
): Promise<void> {
  const srv = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/v1/models") {
        return Response.json({ data: [{ id: "qwen3.5-4b" }] });
      }
      return new Response("not found", { status: 404 });
    },
  });
  try {
    await fn(`http://127.0.0.1:${srv.port}`);
  } finally {
    srv.stop(true);
  }
}

async function runPingaAsync(
  args: string[],
  env: Record<string, string>,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, join(resolve(import.meta.dir, ".."), "bin/pinga.ts"), ...args], {
    cwd: resolve(import.meta.dir, ".."),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exit, stdout, stderr };
}

describe("T78 — pinga doctor sem adapters — tests/doctor.test.ts", () => {
  test("1. finalizeRecord (I18) e law2For", () => {
    expect(DOCTOR_STATUSES).toEqual(["ok", "degraded", "broken", "unverified"]);

    const validOk: DoctorRecord = {
      harness: "manifest",
      check: "integrity",
      status: "ok",
      law2: "pass",
      cmd: ["pinga:internal", "manifest"],
      exit: 0,
      stdout_sha256: "a".repeat(64),
      duration_ms: 10,
      detail: "tudo ok",
    };
    expect(finalizeRecord(validOk)).toEqual(validOk);

    const nullCmd = finalizeRecord({ ...validOk, cmd: null });
    expect(nullCmd.status).toBe("unverified");
    expect(nullCmd.law2).toBe("not run");
    expect(nullCmd.detail.startsWith("rebaixado: ")).toBe(true);

    expect(law2For("ok")).toBe("pass");
    expect(law2For("degraded")).toBe("fail");
    expect(law2For("broken")).toBe("fail");
    expect(law2For("unverified", "missing")).toBe("blocked");
    expect(law2For("unverified", "infra")).toBe("blocked");
    expect(law2For("unverified", "filtered")).toBe("not run");
    expect(law2For("unverified", "timeout")).toBe("not run");
    expect(law2For("unverified")).toBe("not run");
  });

  test("2. só dois registros: manifest/integrity e llm/models", async () => {
    const h = makeHome();
    try {
      const recs = await runDoctor({
        home: h.home,
        env: h.env,
        endpoint: "http://127.0.0.1:9",
      });
      expect(recs.map((r) => `${r.harness}/${r.check}`)).toEqual([
        "manifest/integrity",
        "llm/models",
      ]);
      assertValidDoctorSchema(recs);
      expect(recs[0]!.status).toBe("unverified");
      expect(recs[0]!.detail).toContain("nada instalado");
      expect(recs[1]!.status).toBe("unverified");

      const r = runPinga(["doctor", "--json", "--endpoint", "http://127.0.0.1:9"], h.env);
      expect(r.exit).toBe(0);
      const cliRecs = JSON.parse(r.stdout) as DoctorRecord[];
      expect(cliRecs.length).toBe(2);
    } finally {
      rmSync(h.home, { recursive: true, force: true });
      rmSync(h.state, { recursive: true, force: true });
    }
  });

  test("3. manifest íntegro e endpoint com modelos → ok", async () => {
    const h = makeHome();
    writeManifest(h, "hello.txt", "conteúdo\n");
    try {
      await withModelsServer(async (endpoint) => {
        const recs = await runDoctor({ home: h.home, env: h.env, endpoint });
        assertValidDoctorSchema(recs);
        expect(recs[0]!.status).toBe("ok");
        expect(recs[0]!.detail).toContain("manifest íntegro");
        expect(recs[1]!.status).toBe("ok");
        expect(recs[1]!.detail).toBe("served qwen3.5-4b");

        const texto = await runPingaAsync(["doctor", "--endpoint", endpoint], h.env);
        expect(texto.exit).toBe(0);
        const linhas = texto.stdout.trim().split("\n");
        expect(linhas.length).toBe(2);
        for (const linha of linhas) {
          expect(linha).toMatch(/^(ok|degraded|broken|unverified) [a-z-]+\/[a-z_]+: /);
        }
      });
    } finally {
      rmSync(h.home, { recursive: true, force: true });
      rmSync(h.state, { recursive: true, force: true });
    }
  });

  test("4. drift de sha, alvo ausente e manifest inválido", async () => {
    const h = makeHome();
    writeManifest(h, "hello.txt", "conteúdo\n");
    try {
      writeFileSync(join(h.home, "hello.txt"), "conteúdo alterado\n");
      let recs = await runDoctor({
        home: h.home,
        env: h.env,
        endpoint: "http://127.0.0.1:9",
      });
      expect(recs[0]!.status).toBe("degraded");
      expect(recs[0]!.detail).toContain("sha256 divergente");

      unlinkSync(join(h.home, "hello.txt"));
      recs = await runDoctor({
        home: h.home,
        env: h.env,
        endpoint: "http://127.0.0.1:9",
      });
      expect(recs[0]!.status).toBe("broken");
      expect(recs[0]!.detail).toContain("alvo ausente");
      const cli = runPinga(["doctor", "--json", "--endpoint", "http://127.0.0.1:9"], h.env);
      expect(cli.exit).toBe(1);

      writeFileSync(defaultManifestPath(h.env), "{ invalido");
      recs = await runDoctor({
        home: h.home,
        env: h.env,
        endpoint: "http://127.0.0.1:9",
      });
      expect(recs[0]!.status).toBe("broken");
      expect(recs[0]!.detail).toContain("manifest inválido");
    } finally {
      rmSync(h.home, { recursive: true, force: true });
      rmSync(h.state, { recursive: true, force: true });
    }
  });

  test("5. --only aceita só manifest|llm; adapters saíram", () => {
    const h = makeHome();
    try {
      const rOnly = runPinga(
        ["doctor", "--json", "--only", "manifest", "--endpoint", "http://127.0.0.1:9"],
        h.env,
      );
      expect(rOnly.exit).toBe(0);
      const recs = JSON.parse(rOnly.stdout) as DoctorRecord[];
      expect(recs[0]!.harness).toBe("manifest");
      expect(recs[1]!.status).toBe("unverified");
      expect(recs[1]!.law2).toBe("not run");
      expect(recs[1]!.detail).toBe("filtrado por --only");
      expect(recs[1]!.cmd).toBeNull();

      expect(runPinga(["doctor", "--only", "pi"], h.env).exit).toBe(2);
      expect(runPinga(["doctor", "--only", "claude"], h.env).exit).toBe(2);
      expect(runPinga(["doctor", "--only", "xpto"], h.env).exit).toBe(2);
    } finally {
      rmSync(h.home, { recursive: true, force: true });
      rmSync(h.state, { recursive: true, force: true });
    }
  });
});
