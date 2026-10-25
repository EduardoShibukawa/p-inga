import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DOCTOR_STATUSES,
   type DoctorRecord,
  EMPTY_SHA256,
  doctorCmd,
  finalizeRecord,
  law2For,
  runDoctor,
} from "../src/doctor";
import { defaultManifestPath } from "../src/manifest";
import { runPinga, tmp } from "./helpers/home";
import { makeHarnessHome, readStubLog, writeStubs } from "./helpers/stubs";

const ROOT = resolve(import.meta.dir, "..");
const BIN = join(ROOT, "bin/pinga.ts");

function cleanupHarnessEnv(h: ReturnType<typeof makeHarnessHome>) {
  rmSync(h.home, { recursive: true, force: true });
  rmSync(h.state, { recursive: true, force: true });
  rmSync(h.tmpdir, { recursive: true, force: true });
  rmSync(h.source, { recursive: true, force: true });
  rmSync(h.bin, { recursive: true, force: true });
}

async function runPingaAsync(
  args: string[],
  env: Record<string, string>,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const realTmp = realpathSync(tmpdir());
  for (const key of ["HOME", "XDG_STATE_HOME", "TMPDIR"] as const) {
    const val = env[key];
    if (!val || !val.startsWith(realTmp)) {
      throw new Error(`I16 violation: ${key}=${String(val)}`);
    }
  }
  const childEnv: Record<string, string> = { ...env };
  delete childEnv.XDG_CONFIG_HOME;
  delete childEnv.XDG_DATA_HOME;
  delete childEnv.PI_CODING_AGENT_DIR;

  const proc = Bun.spawn([process.execPath, BIN, ...args], {
    cwd: ROOT,
    env: childEnv,
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

describe("T13 — pinga doctor (I18) — tests/doctor.test.ts", () => {
  test("14. finalizeRecord (I18) e law2For", () => {
    expect(DOCTOR_STATUSES).toEqual(["ok", "degraded", "broken", "unverified"]);
    expect(EMPTY_SHA256).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );

    const validOk: DoctorRecord = {
      harness: "claude",
      check: "plugin_list",
      status: "ok",
      law2: "pass",
      cmd: ["claude", "plugin", "list"],
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

    const badExit = finalizeRecord({ ...validOk, exit: 1 });
    expect(badExit.status).toBe("unverified");

    const emptySha = finalizeRecord({ ...validOk, stdout_sha256: EMPTY_SHA256 });
    expect(emptySha.status).toBe("unverified");

    expect(law2For("ok")).toBe("pass");
    expect(law2For("degraded")).toBe("fail");
    expect(law2For("degraded", "empty")).toBe("fail");
    expect(law2For("broken")).toBe("fail");
    expect(law2For("unverified", "missing")).toBe("blocked");
    expect(law2For("unverified", "infra")).toBe("blocked");
    expect(law2For("unverified", "filtered")).toBe("not run");
    expect(law2For("unverified", "timeout")).toBe("not run");
    expect(law2For("unverified")).toBe("not run");
  });

  test("15, 20, 22, 23, 24. Tudo saudável, manifest degradado/broken, --only claude, saída texto e schema", async () => {
    const h = makeHarnessHome();
    const srv = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/v1/models") {
          return Response.json({ data: [{ id: "qwen3.5-4b" }] });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const endpoint = `http://127.0.0.1:${srv.port}`;

    try {
      expect(runPinga(["install", "--dry-run"], h.env).exit).toBe(0);
      expect(runPinga(["install", "--apply"], h.env).exit).toBe(0);

      // 15. Tudo saudável
      const r15 = await runPingaAsync(
        ["doctor", "--json", "--endpoint", endpoint],
        h.env,
      );
      expect(r15.exit).toBe(0);
      const recs15 = JSON.parse(r15.stdout) as DoctorRecord[];
      expect(recs15.length).toBe(9);
      assertValidDoctorSchema(recs15);
      expect(recs15.map((r) => `${r.harness}/${r.check}`)).toEqual([
        "manifest/integrity",
        "pi/global_status",
        "claude/plugin_list",
        "claude/plugin_validate",
        "opencode/plugin_list",
        "hermes/plugins_list",
        "hermes/doctor",
        "tuios/integration_status",
        "llm/models",
      ]);
      for (const r of recs15) {
        expect(r.status).toBe("ok");
      }
      expect(recs15[8]!.detail).toBe("served qwen3.5-4b");

      // 23. Texto sem --json
      const r23 = await runPingaAsync(["doctor", "--endpoint", endpoint], h.env);
      expect(r23.exit).toBe(0);
      const lines23 = r23.stdout.trim().split("\n");
      expect(lines23.length).toBe(9);
      for (const line of lines23) {
        expect(line).toMatch(/^(ok|degraded|broken|unverified) [a-z-]+\/[a-z_]+: /);
      }

      // 22. --only claude
      writeFileSync(h.log, "");
      const r22 = await runPingaAsync(
        ["doctor", "--json", "--only", "claude", "--endpoint", endpoint],
        h.env,
      );
      expect(r22.exit).toBe(0);
      const recs22 = JSON.parse(r22.stdout) as DoctorRecord[];
      assertValidDoctorSchema(recs22);
      const claudeRecs = recs22.filter((r) => r.harness === "claude");
      const otherRecs = recs22.filter((r) => r.harness !== "claude");
      expect(claudeRecs.length).toBe(2);
      expect(claudeRecs.every((r) => r.status === "ok")).toBe(true);
      expect(otherRecs.length).toBe(7);
      for (const o of otherRecs) {
        expect(o.status).toBe("unverified");
        expect(o.law2).toBe("not run");
        expect(o.detail).toBe("filtrado por --only");
        expect(o.cmd).toBeNull();
      }
      const logs22 = readStubLog(h.log);
      expect(logs22.every((l) => l.name === "claude")).toBe(true);

      expect(
        runPinga(["doctor", "--only", "xpto"], h.env).exit,
      ).toBe(2);

      // 20. Manifest: mudar theme -> degraded; apagar pi-harness.ts -> broken (exit 1); manifest JSON inválido -> broken
      const settingsPath = join(h.home, ".claude/settings.json");
      const sObj = JSON.parse(readFileSync(settingsPath, "utf8"));
      sObj.theme = "light";
      writeFileSync(settingsPath, JSON.stringify(sObj, null, 2) + "\n");

      const r20a = await runPingaAsync(
        ["doctor", "--json", "--endpoint", endpoint],
        h.env,
      );
      const recs20a = JSON.parse(r20a.stdout) as DoctorRecord[];
      assertValidDoctorSchema(recs20a);
      expect(recs20a[0]!.status).toBe("degraded");

      unlinkSync(join(h.home, ".config/opencode/plugins/pi-harness.ts"));
      const r20b = await runPingaAsync(
        ["doctor", "--json", "--endpoint", endpoint],
        h.env,
      );
      expect(r20b.exit).toBe(1);
      const recs20b = JSON.parse(r20b.stdout) as DoctorRecord[];
      assertValidDoctorSchema(recs20b);
      expect(recs20b[0]!.status).toBe("broken");

      writeFileSync(defaultManifestPath(h.env), "{ invalido");
      const r20c = await runPingaAsync(
        ["doctor", "--json", "--endpoint", endpoint],
        h.env,
      );
      expect(r20c.exit).toBe(1);
      const recs20c = JSON.parse(r20c.stdout) as DoctorRecord[];
      assertValidDoctorSchema(recs20c);
      expect(recs20c[0]!.status).toBe("broken");
    } finally {
      srv.stop(true);
      cleanupHarnessEnv(h);
    }
  });

  test("16–19, 21, 25. T4b sem binários, broken, degraded, timeout, LLM variações e CLI", async () => {
    const h = makeHarnessHome();
    const emptyBin = tmp("pinga-t13-emptybin-");
    try {
      // 16. T4b sem binários
      const envNoBins = {
        ...h.env,
        PATH: emptyBin,
      };
      const r16 = await runPingaAsync(
        ["doctor", "--json", "--endpoint", "http://127.0.0.1:9"],
        envNoBins,
      );
      expect(r16.exit).toBe(0);
      const recs16 = JSON.parse(r16.stdout) as DoctorRecord[];
      assertValidDoctorSchema(recs16);
      expect(recs16.every((r) => r.status !== "ok")).toBe(true);
      expect(recs16[0]!.status).toBe("unverified");
      expect(recs16[0]!.detail).toContain("nada instalado");
      for (const r of recs16.slice(1, 8)) {
        expect(r.status).toBe("unverified");
        expect(r.law2).toBe("blocked");
        expect(r.cmd).toBeNull();
      }
      expect(recs16[8]!.status).toBe("unverified");
      expect(recs16[8]!.law2).toBe("blocked");

      // 17. Broken: claude plugin list exit 1 -> broken/fail, doctor exit 1
      writeStubs(h.bin, {
        claude: 'if (args[1] === "list") process.exit(1); process.stdout.write("ok\\n"); process.exit(0);',
      });
      const r17 = await runPingaAsync(
        ["doctor", "--json", "--endpoint", "http://127.0.0.1:9"],
        h.env,
      );
      expect(r17.exit).toBe(1);
      const recs17 = JSON.parse(r17.stdout) as DoctorRecord[];
      assertValidDoctorSchema(recs17);
      const claudeList17 = recs17.find((r) => r.check === "plugin_list" && r.harness === "claude")!;
      expect(claudeList17.status).toBe("broken");
      expect(claudeList17.law2).toBe("fail");
      expect(claudeList17.exit).toBe(1);

      // 18. Degraded: disabled, stdout vazio, tuios not installed, pi JSON inválido, hermes disabled
      writeStubs(h.bin, {
        claude:
          'if (args[1] === "list") { process.stdout.write("pi-harness@pi-harness-local\\n  Status: ✘ disabled\\n"); process.exit(0); } process.stdout.write("ok\\n"); process.exit(0);',
        tuios:
          'process.stdout.write("claude-code installed\\npi not installed\\n"); process.exit(0);',
        "pi-harness": 'process.stdout.write("{"); process.exit(0);',
        hermes:
          'if (args[1] === "list") { process.stdout.write("pi-harness  disabled\\n"); process.exit(0); } process.stdout.write("ok\\n"); process.exit(0);',
        opencode: 'process.stdout.write("   \\n"); process.exit(0);',
      });
      const r18 = await runPingaAsync(
        ["doctor", "--json", "--endpoint", "http://127.0.0.1:9"],
        h.env,
      );
      const recs18 = JSON.parse(r18.stdout) as DoctorRecord[];
      assertValidDoctorSchema(recs18);
      expect(recs18.find((r) => r.harness === "claude" && r.check === "plugin_list")!.status).toBe("degraded");
      expect(recs18.find((r) => r.harness === "tuios")!.status).toBe("degraded");
      expect(recs18.find((r) => r.harness === "pi")!.status).toBe("degraded");
      expect(recs18.find((r) => r.harness === "hermes" && r.check === "plugins_list")!.status).toBe("degraded");
      const oc18 = recs18.find((r) => r.harness === "opencode")!;
      expect(oc18.status).toBe("degraded");
      expect(oc18.detail).toContain("saída vazia");

      // 19. Timeout: opencode sleep 5 com PINGA_DOCTOR_TIMEOUT_MS=200
      writeStubs(h.bin, {
        opencode: "Bun.sleepSync(5000); process.exit(0);",
      });
      const r19 = await runPingaAsync(
        ["doctor", "--json", "--only", "opencode"],
        { ...h.env, PINGA_DOCTOR_TIMEOUT_MS: "200" },
      );
      const recs19 = JSON.parse(r19.stdout) as DoctorRecord[];
      assertValidDoctorSchema(recs19);
      const oc19 = recs19.find((r) => r.harness === "opencode")!;
      expect(oc19.status).toBe("unverified");
      expect(oc19.law2).toBe("not run");
      expect(oc19.detail).toContain("timeout");

      // 21. LLM: 2 modelos -> degraded; HTTP 500 -> unverified/blocked; {"data":[]} -> degraded
      let llmMode: "two" | "500" | "empty" = "two";
      const llmSrv = Bun.serve({
        port: 0,
        fetch() {
          if (llmMode === "two") {
            return Response.json({ data: [{ id: "m1" }, { id: "m2" }] });
          }
          if (llmMode === "500") {
            return new Response("err", { status: 500 });
          }
          return Response.json({ data: [] });
        },
      });
      const llmUrl = `http://127.0.0.1:${llmSrv.port}`;
      try {
        const rl1 = await runPingaAsync(
          ["doctor", "--json", "--only", "llm", "--endpoint", llmUrl],
          h.env,
        );
        const recL1 = (JSON.parse(rl1.stdout) as DoctorRecord[]).find(
          (r) => r.harness === "llm",
        )!;
        expect(recL1.status).toBe("degraded");

        llmMode = "500";
        const rl2 = await runPingaAsync(
          ["doctor", "--json", "--only", "llm", "--endpoint", llmUrl],
          h.env,
        );
        const recL2 = (JSON.parse(rl2.stdout) as DoctorRecord[]).find(
          (r) => r.harness === "llm",
        )!;
        expect(recL2.status).toBe("unverified");
        expect(recL2.law2).toBe("blocked");

        llmMode = "empty";
        const rl3 = await runPingaAsync(
          ["doctor", "--json", "--only", "llm", "--endpoint", llmUrl],
          h.env,
        );
        const recL3 = (JSON.parse(rl3.stdout) as DoctorRecord[]).find(
          (r) => r.harness === "llm",
        )!;
        expect(recL3.status).toBe("degraded");
      } finally {
        llmSrv.stop(true);
      }

      // 25. CLI
      expect(runPinga(["doctor", "--endpoint"], h.env).exit).toBe(2);
      expect(runPinga(["doctor", "--xpto"], h.env).exit).toBe(2);
      const usage = runPinga([], h.env);
      expect(usage.stdout + usage.stderr).toContain("pinga doctor");
    } finally {
      rmSync(emptyBin, { recursive: true, force: true });
      cleanupHarnessEnv(h);
    }
  });
});
