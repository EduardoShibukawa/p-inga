import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MODES } from "../src/mode";
import { readDashboardConfig } from "../web/server";

const ROOT = resolve(import.meta.dir, "..");
const CLI = join(ROOT, "bin/pinga.ts");
const BUN = process.execPath;

const created: string[] = [];

function freshDir(prefix = "pinga-t39-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of created) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* limpeza best-effort de diretório temporário */
    }
  }
});

function run(args: string[], env: Record<string, string> = {}) {
  const res = spawnSync([BUN, CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 120_000,
  });
  return {
    code: res.exitCode ?? -1,
    out: res.stdout.toString(),
    err: res.stderr.toString(),
  };
}

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function lines(text: string): string[] {
  return text.split("\n").filter((l) => l.trim() !== "");
}

/** Docs ativos no escopo desta task (a lista `touch` do PLAN.md). */
const ACTIVE_DOCS = [
  "docs/intro.md",
  "docs/guides/quickstart.md",
  "docs/concepts/ledger.md",
  "docs/concepts/invariants.md",
  "README.md",
];

/** Comandos `bun …` de um arquivo markdown, na ordem em que aparecem. */
function bunCommands(md: string): string[] {
  const cmds: string[] = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\s*bun\s+(\S.*)$/);
    // Comentário de fim de linha não faz parte do comando.
    if (m) cmds.push(m[1].split(/\s+#/)[0].trim());
  }
  return cmds;
}

/** Lê o stdout de um processo até casar o padrão (ou estourar o tempo). */
async function readUntil(
  stream: ReadableStream<Uint8Array>,
  pattern: RegExp,
  timeoutMs: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: undefined }>((res) =>
        setTimeout(() => res({ done: true }), Math.max(0, deadline - Date.now())),
      ),
    ]);
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
    if (pattern.test(text)) break;
  }
  return text;
}

describe("T39 · T1 docs eval recusa diretório sem stack trace", () => {
  test("diretório com markdown vira erro de uso em uma linha", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "nota.md"), "# nota\n");

    const r = run(["docs", "eval", dir]);

    expect(r.code).toBe(2);
    const errLines = lines(r.err);
    expect(errLines.length).toBe(1);
    expect(errLines[0]).toContain(dir);
    expect(errLines[0]).toMatch(/diretório/i);
    expect(errLines[0]).toMatch(/arquivo/i);
    expect(r.err).not.toMatch(/EISDIR/);
    expect(r.err).not.toMatch(/^\s+at /m);
    expect(r.out.trim()).toBe("");
  });

  test("diretório vazio recebe o mesmo erro de uso", () => {
    const dir = freshDir();
    const r = run(["docs", "eval", dir]);

    expect(r.code).toBe(2);
    expect(lines(r.err).length).toBe(1);
    expect(r.err).toMatch(/diretório/i);
    expect(r.err).not.toMatch(/EISDIR/);
  });

  test("arquivo inexistente continua sendo erro de uma linha", () => {
    const r = run(["docs", "eval", join(freshDir(), "fantasma.md")]);

    expect(r.code).toBe(2);
    expect(lines(r.err).length).toBe(1);
    expect(r.err).toMatch(/não encontrado/);
  });
});

describe("T39 · T2 comando inválido imprime token e uso curto", () => {
  test("token rejeitado aparece e o USAGE inteiro não é despejado", () => {
    const r = run(["frobnicate"]);

    expect(r.code).toBe(2);
    expect(r.err).toContain("frobnicate");
    expect(lines(r.err).length).toBeLessThanOrEqual(6);
    expect(r.err).not.toContain("pinga learn propose");
    expect(r.err).not.toContain("pinga compact");
  });

  test("erro de digitação sugere o comando próximo", () => {
    const r = run(["verfy"]);

    expect(r.code).toBe(2);
    expect(r.err).toContain("verfy");
    expect(r.err).toMatch(/verify/);
    expect(lines(r.err).length).toBeLessThanOrEqual(6);
  });

  test("comando válido sem alvo ainda mostra o usage completo", () => {
    const r = run(["docs", "eval"]);

    expect(r.code).toBe(2);
    expect(r.err).toContain("pinga learn propose");
    expect(r.err).toContain("pinga compact");
  });
});

describe("T39 · T3 pinga web sobe o painel e está no usage", () => {
  test("porta padrão do painel é 4242", () => {
    expect(readDashboardConfig({}, ROOT).port).toBe(4242);
  });

  test("usage documenta pinga web", () => {
    const cli = read("src/cli.ts");
    expect(cli).toMatch(/pinga web\b/);
  });

  test("package.json expõe o script web", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.web).toBe("bun bin/pinga.ts web");
  });

  test("README e quickstart ensinam o comando", () => {
    expect(read("README.md")).toContain("bun bin/pinga.ts web");
    expect(read("docs/guides/quickstart.md")).toContain("bun bin/pinga.ts web");
  });

  test(
    "pinga web sobe o painel e anuncia a URL",
    async () => {
      const root = freshDir();
      const proc = Bun.spawn([BUN, CLI, "web"], {
        cwd: ROOT,
        env: {
          ...process.env,
          PINGA_ROOT: root,
          PINGA_WEB_PORT: "0",
          PINGA_HTML_FILE: join(ROOT, "web/index.html"),
          PINGA_LEDGER: join(root, "ledger.db"),
          PINGA_LEARN_DB: join(root, "learn.db"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      let text = "";
      try {
        text = await readUntil(proc.stdout, /http:\/\/localhost:\d+/, 20_000);
      } finally {
        proc.kill();
        await proc.exited;
      }

      expect(text).toMatch(/http:\/\/localhost:\d+/);
      expect(text.toLowerCase()).toContain("web");
    },
    30_000,
  );
});

describe("T39 · D1 onboarding usa caminho que existe", () => {
  const docFiles = ["docs/guides/quickstart.md", "docs/concepts/ledger.md"];

  test("nenhum doc ativo cita o binário fantasma .pinga/pinga-stable", () => {
    for (const file of docFiles) {
      expect(read(file)).not.toContain(".pinga/pinga-stable");
    }
  });

  test("todo comando bun dos docs aponta para um arquivo existente", () => {
    let total = 0;
    for (const file of docFiles) {
      for (const cmd of bunCommands(read(file))) {
        const entry = cmd.split(/\s+/)[0];
        total++;
        expect({ file, entry, exists: existsSync(join(ROOT, entry)) }).toEqual({
          file,
          entry,
          exists: true,
        });
      }
    }
    expect(total).toBeGreaterThanOrEqual(4);
  });

  test("quickstart usa os comandos reais da CLI", () => {
    const quickstart = read("docs/guides/quickstart.md");
    expect(quickstart).toContain("bun bin/pinga.ts doctor");
    expect(quickstart).toContain("bun bin/pinga.ts ledger verify");
    expect(quickstart).toContain("bun bin/pinga.ts verify");
    expect(quickstart).toContain("tasks/T32/PLAN.md");
    expect(existsSync(join(ROOT, "tasks/T32/PLAN.md"))).toBe(true);
  });

  test("o comando de verificação do quickstart executa de verdade", () => {
    const ledger = join(freshDir(), "ledger.db");
    const r = run(["ledger", "verify", "--ledger", ledger]);

    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^ok \d+/m);
  });
});

describe("T39 · D2 discord sai do caminho ativo", () => {
  test("apêndice existe e guarda I20 e o nó do fluxo", () => {
    const appendix = join(ROOT, "docs/appendix/discord.md");
    expect(existsSync(appendix)).toBe(true);
    const text = readFileSync(appendix, "utf8");
    expect(text).toContain("I20");
    expect(text).toContain("DISCORD");
    expect(text.toLowerCase()).toContain("fora de escopo");
  });

  test("nenhum doc ativo menciona discord", () => {
    for (const file of ACTIVE_DOCS) {
      expect({ file, discord: /discord/i.test(read(file)) }).toEqual({
        file,
        discord: false,
      });
    }
  });

  test("diagrama canônico do intro não promete notificação", () => {
    const intro = read("docs/intro.md");
    expect(intro).not.toMatch(/DISCORD/i);
    expect(intro).not.toMatch(/notify discord/i);
  });
});

describe("T39 · D3 modos da doc vêm de src/mode.ts", () => {
  test("a linha de modos lista exatamente MODES", () => {
    const line = read("docs/concepts/invariants.md")
      .split("\n")
      .find((l) => /modos/i.test(l));
    expect(line).toBeDefined();

    const quoted = [...(line as string).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(quoted).toEqual([...MODES]);
  });

  test("modos antigos não aparecem mais na doc de invariantes", () => {
    const text = read("docs/concepts/invariants.md");
    expect(text).not.toMatch(/`rapido`/);
    expect(text).not.toMatch(/`rigido`/);
  });
});

describe("T39 · D4 README descreve o estado atual", () => {
  test("versão citada bate com package.json", () => {
    const pkg = JSON.parse(read("package.json")) as { version: string };
    const readme = read("README.md");
    expect(readme).toContain(pkg.version);
    expect(readme).not.toMatch(/v0\.1\b(?!\.\d)/);
  });

  test("todo caminho em crase do README existe", () => {
    const readme = read("README.md");
    let checked = 0;
    for (const m of readme.matchAll(/`([^`\n]+)`/g)) {
      const token = m[1].trim();
      const looksLikePath = token.includes("/") && !token.includes(" ");
      if (!looksLikePath) continue;
      if (token.startsWith("-") || token.includes("*") || token.startsWith("/")) continue;
      checked++;
      expect({ token, exists: existsSync(join(ROOT, token)) }).toEqual({
        token,
        exists: true,
      });
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  test("README delega o detalhe para docs/", () => {
    const readme = read("README.md");
    expect(readme).toContain("docs/intro.md");
    expect(readme).not.toContain("`raw/`");
    expect(readme).not.toContain("`state/`");
  });

  test("todo comando bun do README executa", () => {
    const cmds = bunCommands(read("README.md"));
    expect(cmds.length).toBeGreaterThan(0);

    const uniq = [...new Set(cmds)];
    // Todo comando do README aponta para um entrypoint que existe.
    for (const cmd of uniq) {
      if (cmd === "test") continue; // a própria suíte é o done_when desta task
      const entry = cmd.split(/\s+/)[0];
      expect({ cmd, entry, exists: existsSync(join(ROOT, entry)) }).toEqual({
        cmd,
        entry,
        exists: true,
      });
    }

    // O comando de verificação citado executa de verdade e sai limpo.
    const ledgerVerify = uniq.filter((c) => c === "bin/pinga.ts ledger verify");
    expect(ledgerVerify.length).toBe(1);
    const res = run(["ledger", "verify", "--ledger", join(freshDir(), "l.db")]);
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/^ok \d+/m);

    // `web` é coberto pelo teste de subida do painel (T3).
    expect(uniq).toContain("bin/pinga.ts web");
  });
});

describe("T39 · D5 checador de links internos", () => {
  test("todos os links internos de docs/ resolvem", () => {
    const r = run(["docs", "links"]);

    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\d+ links? ok/);
    expect(r.err).toBe("");
  });

  test("link morto falha nomeando arquivo e linha", () => {
    const dir = freshDir("pinga-t39-links-");
    writeFileSync(join(dir, "a.md"), "# a\n\n[B](./missing.html)\n");

    const r = run(["docs", "links", dir]);

    expect(r.code).toBe(1);
    expect(r.out + r.err).toContain("a.md:3");
    expect(r.out + r.err).toContain("missing");
  });

  test("link do intro está normalizado", () => {
    expect(read("docs/intro.md")).toContain("(./guides/quickstart.html)");
    expect(read("docs/intro.md")).not.toMatch(/\]\(guides\//);
  });
});
