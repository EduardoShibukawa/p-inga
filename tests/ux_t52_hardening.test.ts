import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDashboardServer, readDashboardConfig } from "../web/server";

const ROOT = join(import.meta.dir, "..");
const HTML = readFileSync(join(ROOT, "web/index.html"), "utf8");
const SERVER_SRC = readFileSync(join(ROOT, "web/server.ts"), "utf8");

const roots: string[] = [];
const stops: Array<() => void> = [];

afterAll(() => {
  for (const stop of stops) stop();
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pinga-t38-"));
  roots.push(root);
  return root;
}

async function startPanel(env: Record<string, string> = {}, root = freshRoot()) {
  const baseEnv = {
    ...process.env,
    PATH: process.env.PATH ?? "",
    PINGA_ROOT: root,
    PINGA_WEB_PORT: "0",
    PINGA_HTML_FILE: join(ROOT, "web/index.html"),
    PINGA_LEDGER: join(root, "ledger.db"),
    PINGA_LEARN_DB: join(root, "learn.db"),
    ...env,
  };
  const config = readDashboardConfig(baseEnv, root);
  const panel = createDashboardServer(config);
  stops.push(() => panel.stop());
  return { panel, root, base: `http://127.0.0.1:${panel.port}` };
}

/**
 * Extrai o corpo real de `appendLog` de web/index.html e executa num DOM falso.
 * O teste roda o código que o navegador roda — não uma reimplementação.
 */
function extractFunction(name: string): string {
  const start = HTML.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`função ${name} não encontrada em web/index.html`);
  let depth = 0;
  let i = HTML.indexOf("{", start);
  const begin = i;
  for (; i < HTML.length; i++) {
    if (HTML[i] === "{") depth++;
    else if (HTML[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return HTML.slice(start, i + 1);
}

type FakeNode = {
  tag: string;
  className: string;
  textContent: string;
  innerHTML: string;
  children: FakeNode[];
  appendChild(node: FakeNode): FakeNode;
  classList: { add(): void; remove(): void; contains(): boolean };
  style: Record<string, string>;
};

function fakeNode(tag: string): FakeNode {
  const node: FakeNode = {
    tag,
    className: "",
    textContent: "",
    innerHTML: "",
    children: [],
    appendChild(child: FakeNode) {
      node.children.push(child);
      return child;
    },
    classList: { add() {}, remove() {}, contains: () => false },
    style: {},
  };
  return node;
}

function runAppendLog(payload: string) {
  const body = fakeNode("div");
  body.scrollTop = 0;
  (body as unknown as { scrollHeight: number }).scrollHeight = 0;
  const badge = fakeNode("span");
  const document = {
    getElementById(id: string) {
      if (id === "terminal-body") return body;
      if (id === "log-count-badge") return badge;
      return null;
    },
    createElement(tag: string) {
      return fakeNode(tag);
    },
  };
  // `alert` inexistente no escopo: se o payload executar, o teste explode.
  const factory = new Function("document", "window", "lucide", `${extractFunction("appendLog")}\nreturn appendLog;`);
  const appendLog = factory(document, { lucide: { createIcons() {} } }, { createIcons() {} }) as (log: unknown) => void;
  appendLog({ source: "ast", level: "info", text: payload, timestamp: "2026-10-27T10:00:00.000Z" });
  return { body, badge };
}

function walk(node: FakeNode, visit: (n: FakeNode) => void) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

describe("T52 · W6 estrutura semântica e acessível", () => {
  test("exatamente um <h1> no documento", () => {
    const h1s = HTML.match(/<h1[\s>]/g) ?? [];
    expect(h1s.length).toBe(1);
  });

  test("landmarks main e nav existem", () => {
    expect(HTML).toMatch(/<main[\s>]/);
    expect(HTML).toMatch(/<nav[\s>]/);
    expect(HTML).toMatch(/<\/main>/);
    expect(HTML).toMatch(/<\/nav>/);
  });

  test("abas expõem role=tab e aria-selected", () => {
    const tabs = HTML.match(/role="tab"/g) ?? [];
    expect(tabs.length).toBeGreaterThanOrEqual(4);
    expect(HTML).toMatch(/aria-selected="true"/);
    expect(HTML).toMatch(/aria-selected="false"/);
    expect(HTML).toMatch(/role="tablist"/);
  });

  test("resultado da verificação é região viva (aria-live=polite)", () => {
    expect(HTML).toMatch(/aria-live="polite"/);
    expect(HTML).not.toMatch(/aria-live="assertive"/);
  });

  test("HTML servido pelo painel também tem um único h1", async () => {
    const { base } = await startPanel();
    const res = await fetch(`${base}/`);
    const served = await res.text();
    expect(res.status).toBe(200);
    expect((served.match(/<h1[\s>]/g) ?? []).length).toBe(1);
  });
});

describe("T52 · W7 render sem injeção", () => {
  test("appendLog injeta <img onerror> como texto e nada executa", () => {
    const payload = `<img src=x onerror="globalThis.__pwned = true">`;
    const { body } = runAppendLog(payload);

    const texts: string[] = [];
    const innerHTMLs: string[] = [];
    walk(body, (node) => {
      texts.push(node.textContent);
      innerHTMLs.push(node.innerHTML);
    });

    expect(texts.join("\n")).toContain(payload);
    for (const markup of innerHTMLs) {
      expect(markup).not.toContain("onerror");
      expect(markup).not.toContain("<img");
    }
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  test("log.text nunca é interpolado em innerHTML", () => {
    expect(HTML).not.toMatch(/innerHTML\s*=\s*[^;]*\$\{[^}]*log\.text/);
    const appendLog = extractFunction("appendLog");
    expect(appendLog).toContain("textContent");
    expect(appendLog).not.toMatch(/innerHTML\s*=\s*[^;]*\$\{/);
  });

  test("mensagens de erro de rede também usam textContent", () => {
    const report = extractFunction("reportFetchError");
    expect(report).toContain("textContent");
    expect(report).not.toMatch(/innerHTML\s*=/);
  });
});

describe("T52 · W8 CORS restrito à origem do painel", () => {
  test("POST de origem estranha recebe 403", async () => {
    const { base } = await startPanel();
    const res = await fetch(`${base}/api/action/log`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ source: "test", text: "x" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect((body.error ?? "").toLowerCase()).toContain("origem");
  });

  test("POST da própria origem é aceito", async () => {
    const { base } = await startPanel();
    const res = await fetch(`${base}/api/action/log`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ source: "test", text: "ok" }),
    });
    expect(res.status).toBeLessThan(400);
  });

  test("nenhuma resposta publica Allow-Origin curinga", async () => {
    const { base } = await startPanel();
    const res = await fetch(`${base}/api/receipts`, { headers: { origin: "http://evil.example" } });
    const allow = res.headers.get("access-control-allow-origin");
    expect(allow).not.toBe("*");
    expect(SERVER_SRC).not.toContain("Access-Control-Allow-Origin: *");
    expect(SERVER_SRC).not.toContain('"Access-Control-Allow-Origin": "*"');
  });
});

describe("T52 · W9 configuração por env, sem caminho de máquina", () => {
  test("GIRA_MAP, OPENCODE_BIN e LEDGER_PATH são lidos do ambiente", () => {
    const root = freshRoot();
    const cfg = readDashboardConfig(
      {
        ...process.env,
        GIRA_MAP: "/tmp/map.json",
        OPENCODE_BIN: "/opt/opencode",
        LEDGER_PATH: "/tmp/ledger.db",
        PINGA_ROOT: root,
        PINGA_WEB_PORT: "0",
      } as Record<string, string>,
      root,
    );
    expect(cfg.giraIndexPath).toBe("/tmp/map.json");
    expect(cfg.opencodeBin).toBe("/opt/opencode");
    expect(cfg.ledgerPath).toBe("/tmp/ledger.db");
  });

  test("defaults são relativos à raiz e não há /home/ hardcoded", () => {
    const root = freshRoot();
    const cfg = readDashboardConfig({ PINGA_ROOT: root, PINGA_WEB_PORT: "0" } as Record<string, string>, root);
    expect(cfg.giraIndexPath.startsWith("/home/")).toBe(false);
    expect(cfg.opencodeBin.startsWith("/home/")).toBe(false);
    expect(SERVER_SRC).not.toContain("/home/shibuka");
  });

  test("/api/graph avisa quando o mapa gira está ausente", async () => {
    const root = freshRoot();
    const { base } = await startPanel(
      { GIRA_MAP: join(root, "nao-existe", "macro-map.json"), OPENCODE_BIN: "opencode-inexistente" },
      root,
    );
    const res = await fetch(`${base}/api/graph`);
    const body = (await res.json()) as { warning?: string; source?: string };
    expect(res.status).toBe(200);
    expect(body.source).toBe("builtin");
    expect(body.warning ?? "").toContain("nao-existe");
  });
});

describe("T52 · W10 estado ao vivo confiável", () => {
  test("SSE emite heartbeat em até 5s", async () => {
    const { base } = await startPanel();
    const controller = new AbortController();
    const res = await fetch(`${base}/api/events`, { signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 7000;
    let sawHeartbeat = false;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes("event: heartbeat")) {
        sawHeartbeat = true;
        break;
      }
    }
    controller.abort();
    expect(sawHeartbeat).toBe(true);
  });

  test("painel mostra idade da última atualização e backoff com teto 30s", () => {
    expect(HTML).toMatch(/última atualização h[áa]/i);
    expect(HTML).toMatch(/30000/);
    expect(HTML).toMatch(/Math\.min\([^)]*30000/);
  });
});

describe("T52 · W11 sem alert/confirm nativos", () => {
  test("index.html não usa alert() nem confirm()", () => {
    expect(HTML).not.toMatch(/(^|[^.\w])alert\s*\(/);
    expect(HTML).not.toMatch(/(^|[^.\w])confirm\s*\(/);
  });

  test("toast + histórico existem no painel", () => {
    expect(HTML).toMatch(/function showToast\(/);
    expect(HTML).toMatch(/toastHistory/);
    expect(HTML).toMatch(/id="toast-stack"/);
  });
});

describe("T52 · W12 contador de leituras persistido", () => {
  test("duas leituras persistem em .pinga/readings.json e sobrevivem a restart", async () => {
    const root = freshRoot();
    const first = await startPanel({}, root);
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${first.base}/api/action/ast-query`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: first.base },
        body: JSON.stringify({ query: "task:T52" }),
      });
      expect(res.status).toBeLessThan(400);
    }

    const file = join(root, ".pinga", "readings.json");
    const persisted = JSON.parse(readFileSync(file, "utf8")) as { consecutive_reads: number };
    expect(persisted.consecutive_reads).toBe(2);

    first.panel.stop();

    const second = await startPanel({}, root);
    const res = await fetch(`${second.base}/api/breakers`);
    const body = (await res.json()) as { breakers?: Array<{ consecutive_reads: number }>; g1?: { consecutive_reads: number } };
    const reads = body.breakers?.[0]?.consecutive_reads ?? body.g1?.consecutive_reads;
    expect(reads).toBe(2);
  }, 20000);

  test("reset-breakers zera o contador persistido", async () => {
    const root = freshRoot();
    const { base } = await startPanel({}, root);
    await fetch(`${base}/api/action/ast-query`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ query: "task:T52" }),
    });
    const reset = await fetch(`${base}/api/action/reset-breakers`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ breaker: "g1" }),
    });
    expect(reset.status).toBeLessThan(400);
    const persisted = JSON.parse(readFileSync(join(root, ".pinga", "readings.json"), "utf8")) as {
      consecutive_reads: number;
    };
    expect(persisted.consecutive_reads).toBe(0);
  });
});
