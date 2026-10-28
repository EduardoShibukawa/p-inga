import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyPlan } from "../src/verify";

/**
 * A4 (PLAN-0010 TASK-06): com `$GINGA_EVENTS` definido o pinga só emite eventos e não fala com o Discord.
 * - `pinga notify <msg>` e `pinga queue --notify` (notice acionável): nenhum `fetch`, exit 0.
 * - Sem `$GINGA_EVENTS` o comportamento antigo continua (um POST ao Discord): é o fallback de quem usa o pinga sozinho.
 * - `resolveDiscordConfig`: só `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID` do ambiente. Não lê `~/.hermes/*`
 *   e não tem canal padrão: faltando qualquer um dos dois → `null`.
 * O `fetch` é trocado por um contador via `bun --preload`, no processo do pinga.
 */

const ROOT = join(import.meta.dir, "..");
const PINGA = join(ROOT, "bin", "pinga.ts");
const tmps: string[] = [];
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (p: string) => {
  const d = mkdtempSync(join(tmpdir(), p));
  tmps.push(d);
  return d;
};

/** HOME falso com credenciais do Hermes que o pinga NÃO pode usar. */
function fakeHome(): string {
  const home = tmp("pinga-dev-home-");
  mkdirSync(join(home, ".hermes", "profiles", "pinga"), { recursive: true });
  writeFileSync(join(home, ".hermes", "profiles", "pinga", ".env"), "DISCORD_BOT_TOKEN=token-do-hermes\n");
  writeFileSync(join(home, ".hermes", ".env"), "DISCORD_BOT_TOKEN=token-do-hermes\n");
  writeFileSync(join(home, ".hermes", "profiles", "pinga", "config.yaml"), "chat_id: '999'\n");
  return home;
}

function env(extra: Record<string, string>, home: string): Record<string, string> {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("DISCORD_") && k !== "GINGA_EVENTS") e[k] = v;
  }
  return { ...e, HOME: home, ...extra };
}

function pinga(args: string[], extra: Record<string, string>, home = fakeHome()) {
  const dir = tmp("pinga-dev-");
  const preload = join(dir, "preload.ts");
  const hits = join(dir, "fetch.log");
  writeFileSync(preload, `import { appendFileSync } from "node:fs";\nglobalThis.fetch = (async (u: any) => { appendFileSync(${JSON.stringify(hits)}, String(u) + "\\n"); return new Response("{}", { status: 200 }); }) as any;\n`);
  const r = Bun.spawnSync(["bun", "--preload", preload, PINGA, ...args], { cwd: ROOT, env: env(extra, home), stdout: "pipe", stderr: "pipe" });
  const calls = existsSync(hits) ? readFileSync(hits, "utf8").split("\n").filter(Boolean) : [];
  return { code: r.exitCode, calls, out: r.stdout.toString(), err: r.stderr.toString() };
}

const DISCORD = { DISCORD_BOT_TOKEN: "tok", DISCORD_CHANNEL_ID: "123" };

describe("pinga notify", () => {
  test("com $GINGA_EVENTS: exit 0 e nenhum fetch", () => {
    const events = join(tmp("pinga-dev-ev-"), "events.jsonl");
    const r = pinga(["notify", "olá"], { ...DISCORD, GINGA_EVENTS: events });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
  });

  test("sem $GINGA_EVENTS: um POST ao Discord (fallback do pinga sozinho)", () => {
    const r = pinga(["notify", "olá"], DISCORD);
    expect(r.code).toBe(0);
    expect(r.calls.length).toBe(1);
    expect(r.calls[0]).toContain("discord.com/api/v10/channels/123/messages");
  });
});

describe("pinga queue --notify", () => {
  function queueWithNotice(): { root: string; ledger: string } {
    const root = tmp("pinga-dev-q-");
    Bun.spawnSync(["git", "init", "-q"], { cwd: root });
    mkdirSync(join(root, "tasks", "T1"), { recursive: true });
    writeFileSync(join(root, "tasks", "T1", "PLAN.md"), ["---", "mode: mvp", "goal: g", 'done_when: "true"', "touch:", "  - tasks/T1/PLAN.md", "---", "# T1", ""].join("\n"));
    const ledger = join(root, "q.db");
    const first = Bun.spawnSync(["bun", PINGA, "queue", "--json", "--root", root, "--ledger", ledger], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
    expect(first.exitCode).toBe(0);
    verifyPlan(join(root, "tasks", "T1", "PLAN.md"), ledger, 1, { noBaseline: true, allowNoDelta: true });
    return { root, ledger };
  }

  test("com $GINGA_EVENTS: aviso acionável não vai ao Discord e o exit é 0", () => {
    const { root, ledger } = queueWithNotice();
    const events = join(tmp("pinga-dev-ev-"), "events.jsonl");
    const r = pinga(["queue", "--notify", "--root", root, "--ledger", ledger], { ...DISCORD, GINGA_EVENTS: events });
    expect(r.code).toBe(0);
    expect(r.calls).toEqual([]);
  });

  test("sem $GINGA_EVENTS: o mesmo aviso vai ao Discord (prova que a fixture gera notice)", () => {
    const { root, ledger } = queueWithNotice();
    const r = pinga(["queue", "--notify", "--root", root, "--ledger", ledger], DISCORD);
    expect(r.code).toBe(0);
    expect(r.calls.length).toBe(1);
  });
});

describe("resolveDiscordConfig", () => {
  function resolve(extra: Record<string, string>) {
    const code = `import { resolveDiscordConfig } from ${JSON.stringify(join(ROOT, "src", "discord.ts"))}; console.log(JSON.stringify(resolveDiscordConfig()));`;
    const r = Bun.spawnSync(["bun", "-e", code], { cwd: ROOT, env: env(extra, fakeHome()), stdout: "pipe", stderr: "pipe" });
    return JSON.parse(r.stdout.toString().trim());
  }

  test("token e canal do ambiente", () => {
    expect(resolve(DISCORD)).toEqual({ token: "tok", channelId: "123" });
  });

  test("só o token: sem canal padrão fixo nem chat_id do Hermes → null", () => {
    expect(resolve({ DISCORD_BOT_TOKEN: "tok" })).toBeNull();
  });

  test("só o canal: não pega o token de ~/.hermes → null", () => {
    expect(resolve({ DISCORD_CHANNEL_ID: "123" })).toBeNull();
  });

  test("o código não cita o canal padrão nem ~/.hermes", () => {
    const src = readFileSync(join(ROOT, "src", "discord.ts"), "utf8");
    expect(src).not.toContain("1563272747591803110");
    expect(src).not.toContain(".hermes");
  });
});
