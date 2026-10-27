import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDashboardServer, readDashboardConfig } from "../web/server";

const ROOT = join(import.meta.dir, "..");
const HTML = readFileSync(join(ROOT, "web/index.html"), "utf8");
const SERVER_SRC = readFileSync(join(ROOT, "web/server.ts"), "utf8");

const roots: string[] = [];
const stops: Array<() => void> = [];

/** Sobe o painel com cwd/root temporário — nenhum teste toca o repo real. */
async function startPanel(env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "pinga-t37-"));
  roots.push(root);
  const cfg = readDashboardConfig(
    {
      PINGA_ROOT: root,
      PINGA_WEB_PORT: "0",
      PINGA_HTML_FILE: join(ROOT, "web/index.html"),
      PINGA_LEDGER: join(root, "ledger.db"),
      PINGA_LEARN_DB: join(root, "learn.db"),
      ...env,
    },
    root,
  );
  const panel = createDashboardServer(cfg);
  stops.push(() => panel.stop());
  return { panel, base: `http://127.0.0.1:${panel.port}`, root };
}

afterAll(() => {
  for (const stop of stops) {
    try {
      stop();
    } catch (err) {
      console.error("falha ao parar painel de teste:", err);
    }
  }
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** Corpos de blocos `catch` vazios (silenciosos) no fonte do servidor. */
function emptyCatches(src: string): string[] {
  const found: string[] = [];
  const re = /catch\s*(?:\([^)]*\))?\s*\{/g;
  for (const m of src.matchAll(re)) {
    const start = m.index! + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    if (body.trim() === "") found.push(m[0]);
  }
  return found;
}

describe("T37 · W1 falha de fetch é visível (status + corpo)", () => {
  test("POST inválido em /api/action/verify responde 500 com mensagem legível", async () => {
    const { base } = await startPanel();
    const res = await fetch(`${base}/api/action/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{isto nao e json",
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { success?: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
    expect((body.error ?? "").length).toBeGreaterThan(0);
  });

  test("painel trata !res.ok antes de ler o corpo e nunca imprime 'Exit undefined'", () => {
    // Um 500 devolve {error} sem exitCode; formatação cega produzia "Exit undefined".
    expect(HTML).toContain("if (!res.ok)");
    expect(HTML).toMatch(/HTTP \$\{res\.status\}/);
    expect(HTML).not.toContain("Exit ${result.exitCode}");
    expect(HTML).not.toMatch(/Exit undefined/);
    expect(HTML).toContain("Tentar de novo");
    expect(HTML).toContain('id="conn-banner"');
  });
});

describe("T37 · W2 rota stub responde 501 e some do painel", () => {
  test("/api/action/session devolve 501 explícito", async () => {
    const { base } = await startPanel();
    const res = await fetch(`${base}/api/action/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start" }),
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { success?: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error ?? "").toMatch(/n[aã]o implementado/i);
  });

  test("index.html não referencia a rota stub", () => {
    expect(HTML).not.toContain("/api/action/session");
  });
});

describe("T37 · W3 dispatch sem opencode é simulação declarada", () => {
  test("dispatch sem binário devolve simulated=true e nunca 'Em execução'", async () => {
    const { base } = await startPanel({ OPENCODE_BIN: join(tmpdir(), "nao-existe-opencode") });
    const res = await fetch(`${base}/api/action/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "T99", model: "hermes", prompt: "teste" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success?: boolean; simulated?: boolean; output?: string };
    expect(body.simulated).toBe(true);
    expect(body.output ?? "").toMatch(/simula/i);
    expect(body.output ?? "").not.toMatch(/Em execu/i);
  });

  test("painel exibe o estado de simulação", () => {
    expect(HTML).toMatch(/simula/i);
  });
});

describe("T37 · W4 nenhum erro é engolido", () => {
  test("web/server.ts não tem catch vazio", () => {
    expect(emptyCatches(SERVER_SRC)).toEqual([]);
  });

  test("loaders do painel reportam no DOM, não só no console", () => {
    expect(HTML).toContain("function reportFetchError");
    expect((HTML.match(/reportFetchError\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(HTML).not.toMatch(/console\.error\('Falha ao carregar/);
  });
});

describe("T37 · W5 ledger ausente é estado explícito", () => {
  test("/api/receipts informa ausência com caminho e comando de correção", async () => {
    const { base, root } = await startPanel();
    const res = await fetch(`${base}/api/receipts`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      receipts?: unknown[];
      total?: number;
      ledger?: { present?: boolean; path?: string; hint?: string };
    };
    expect(body.receipts).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.ledger?.present).toBe(false);
    expect(body.ledger?.path).toBe(join(root, "ledger.db"));
    expect(body.ledger?.hint ?? "").toContain("pinga verify");
    expect(existsSync(body.ledger!.path!)).toBe(false);
  });

  test("painel mostra 'ledger ausente' com o caminho resolvido", () => {
    expect(HTML).toMatch(/ledger ausente/i);
    expect(HTML).toContain("ledger.present");
    expect(HTML).toContain("ledger.path");
  });
});
