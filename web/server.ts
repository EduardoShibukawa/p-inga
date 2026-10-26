import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { defaultLedgerPath } from "../src/ledger";
import { defaultLearnDbPath } from "../src/learn";
import { computeWorkerScoreboard } from "../src/maestro";

const PORT = 4242;
const LEDGER_PATH = defaultLedgerPath();
const LEARN_DB_PATH = defaultLearnDbPath();
const GIRA_INDEX_PATH = "/home/shibuka/Projetos/duh-homelab/gira-g/.gira/macro-map.json";

function openReadOnlyDb(path: string): Database | null {
  if (!existsSync(path)) return null;
  const db = new Database(path, { readonly: true });
  return db;
}

const sseClients = new Set<ReadableStreamDefaultController>();

function notifySse(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.enqueue(new TextEncoder().encode(payload));
    } catch {
      sseClients.delete(client);
    }
  }
}

// Watcher do ledger para envio reativo via SSE
if (existsSync(LEDGER_PATH)) {
  let lastCount = 0;
  setInterval(() => {
    try {
      const db = openReadOnlyDb(LEDGER_PATH);
      if (!db) return;
      const count = (db.query("SELECT COUNT(*) as c FROM receipts").get() as any)?.c ?? 0;
      if (count !== lastCount) {
        lastCount = count;
        const lastReceipt = db.query("SELECT * FROM receipts ORDER BY seq DESC LIMIT 1").get();
        notifySse("receipt", lastReceipt);
      }
      db.close();
    } catch {}
  }, 2000);
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>P-Ingá Homelab Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/cytoscape/dist/cytoscape.min.js"></script>
</head>
<body class="bg-slate-950 text-slate-100 font-sans p-6">
  <header class="flex justify-between items-center pb-6 border-b border-slate-800 mb-6">
    <div>
      <h1 class="text-2xl font-bold text-emerald-400">🛡️ P-Ingá Production Homelab</h1>
      <p class="text-sm text-slate-400">Motor Determinístico de Verificação e Governança SDLC</p>
    </div>
    <div id="connection-status" class="px-3 py-1 bg-emerald-950 text-emerald-400 border border-emerald-800 rounded-full text-xs">
      ● Conectado (SSE Ativo)
    </div>
  </header>

  <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
    <!-- Placar Maestro -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
      <h2 class="text-lg font-semibold text-sky-400 mb-4">🎼 Placar de Operários (Maestro)</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-xs">
          <thead>
            <tr class="text-slate-400 border-b border-slate-800">
              <th class="pb-2">Modelo</th>
              <th class="pb-2">FTPR</th>
              <th class="pb-2">Mediana Tok</th>
              <th class="pb-2">Disjuntores</th>
            </tr>
          </thead>
          <tbody id="scoreboard-body" class="divide-y divide-slate-800/50">
            <tr><td colspan="4" class="py-4 text-center text-slate-500">Carregando métricas...</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Árvore de Recibos Criptográficos -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
      <h2 class="text-lg font-semibold text-emerald-400 mb-4">📜 Cadeia de Recibos SHA256</h2>
      <div id="receipts-list" class="space-y-3 max-h-[500px] overflow-y-auto pr-2">
        <div class="text-xs text-slate-500">Carregando cadeia...</div>
      </div>
    </div>

    <!-- Grafo de Componentes Gira-G -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col">
      <h2 class="text-lg font-semibold text-purple-400 mb-4">📐 Grafo Semântico AST (Gira-G)</h2>
      <div id="cy" class="w-full h-[450px] bg-slate-950 rounded border border-slate-800"></div>
    </div>
  </div>

  <script>
    async function loadScoreboard() {
      try {
        const res = await fetch('/api/scoreboard');
        const data = await res.json();
        const tbody = document.getElementById('scoreboard-body');
        tbody.innerHTML = (data.workers || []).map(w => \`
          <tr class="hover:bg-slate-800/40">
            <td class="py-2.5 font-mono text-emerald-300">\${w.model}</td>
            <td class="py-2.5 font-bold \${w.ftpr >= 0.7 ? 'text-emerald-400' : 'text-amber-400'}">\${(w.ftpr * 100).toFixed(0)}%</td>
            <td class="py-2.5 text-slate-300">\${w.median_tokens_per_verified ?? 'N/A'}</td>
            <td class="py-2.5 \${w.breaker_trips > 0 ? 'text-rose-400 font-bold' : 'text-slate-500'}">\${w.breaker_trips}</td>
          </tr>
        \`).join('') || '<tr><td colspan="4" class="py-4 text-center text-slate-500">Nenhum operário registrado</td></tr>';
      } catch (e) {
        console.error('Scoreboard load error:', e);
      }
    }

    async function loadReceipts() {
      try {
        const res = await fetch('/api/receipts');
        const data = await res.json();
        const list = document.getElementById('receipts-list');
        list.innerHTML = (data.receipts || []).map(r => \`
          <div class="p-3 bg-slate-950 border border-slate-800/80 rounded-lg hover:border-emerald-700/50 transition">
            <div class="flex justify-between items-center mb-1">
              <span class="font-bold text-xs text-emerald-400">#\${r.seq} \${r.task}</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold \${r.status === 'pass' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'}">\${r.status}</span>
            </div>
            <div class="font-mono text-[10px] text-slate-500 truncate" title="\${r.hash}">SHA: \${(r.hash || '').slice(0, 16)}...</div>
            <div class="text-[10px] text-slate-400 mt-1">Autor: \${r.parsed?.author?.model ?? 'desconhecido'}</div>
          </div>
        \`).join('') || '<div class="text-xs text-slate-500">Nenhum recibo no ledger</div>';
      } catch (e) {
        console.error('Receipts load error:', e);
      }
    }

    function initGraph() {
      fetch('/api/graph').then(r => r.json()).then(data => {
        const elements = [];
        (data.nodes || []).forEach(n => elements.push({ data: { id: n.id, label: n.id } }));
        (data.edges || []).forEach(e => elements.push({ data: { source: e.from, target: e.to } }));

        cytoscape({
          container: document.getElementById('cy'),
          elements: elements.length > 0 ? elements : [
            { data: { id: 'p-inga', label: 'p-inga (core)' } },
            { data: { id: 'gira-g', label: 'gira-g (ast)' } },
            { data: { id: 'tuios', label: 'tuios (entrypoint)' } },
            { data: { id: 'hermes', label: 'hermes (chat)' } },
            { data: { source: 'tuios', target: 'p-inga' } },
            { data: { source: 'hermes', target: 'p-inga' } },
            { data: { source: 'p-inga', target: 'gira-g' } }
          ],
          style: [
            { selector: 'node', style: { 'background-color': '#8b5cf6', 'label': 'data(label)', 'color': '#f8fafc', 'font-size': '10px' } },
            { selector: 'edge', style: { 'width': 1.5, 'line-color': '#475569', 'target-arrow-color': '#475569', 'target-arrow-shape': 'triangle' } }
          ],
          layout: { name: 'cose', padding: 20 }
        });
      }).catch(() => {});
    }

    loadScoreboard();
    loadReceipts();
    initGraph();

    // Conexão SSE
    const evtSource = new EventSource('/api/events');
    evtSource.addEventListener('receipt', () => {
      loadReceipts();
      loadScoreboard();
    });
  </script>
</body>
</html>`;

export const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // 1. SSE Stream
    if (url.pathname === "/api/events") {
      const stream = new ReadableStream({
        start(controller) {
          sseClients.add(controller);
        },
        cancel(controller) {
          sseClients.delete(controller);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // 2. API Scoreboard Maestro
    if (url.pathname === "/api/scoreboard") {
      try {
        const scoreboard = await computeWorkerScoreboard(LEDGER_PATH, LEARN_DB_PATH);
        return Response.json(scoreboard);
      } catch (e: any) {
        return Response.json({ workers: [], error: e.message });
      }
    }

    // 3. API Recibos Criptográficos (Merkle Chain)
    if (url.pathname === "/api/receipts") {
      const db = openReadOnlyDb(LEDGER_PATH);
      if (!db) return Response.json({ receipts: [] });
      try {
        const rows = db
          .query("SELECT seq, task, status, hash, prev_hash, created_at, body FROM receipts ORDER BY seq DESC LIMIT 100")
          .all() as any[];
        db.close();
        return Response.json({
          total: rows.length,
          receipts: rows.map((r) => {
            let parsed = null;
            try {
              parsed = JSON.parse(r.body);
            } catch {}
            return {
              ...r,
              parsed,
            };
          }),
        });
      } catch (e: any) {
        db.close();
        return Response.json({ receipts: [], error: e.message });
      }
    }

    // 4. API Grafo de Dependências Gira-G
    if (url.pathname === "/api/graph") {
      if (existsSync(GIRA_INDEX_PATH)) {
        try {
          const raw = readFileSync(GIRA_INDEX_PATH, "utf8");
          return new Response(raw, { headers: { "Content-Type": "application/json" } });
        } catch {}
      }
      return Response.json({ nodes: [], edges: [], message: "gira macro-map ausente" });
    }

    // 5. Interface Visual Reativa
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML_PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[P-INGA DASHBOARD] Ativo em http://localhost:${PORT}`);
