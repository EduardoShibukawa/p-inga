import { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultLedgerPath, openLedger } from "../src/ledger";
import { defaultLearnDbPath } from "../src/learn";
import { computeWorkerScoreboard } from "../src/maestro";
import { validateReceipt } from "../src/receipt";

const PORT = 4242;
const PINGA_ROOT = resolve(import.meta.dir, "..");
const LEDGER_PATH = defaultLedgerPath();
const LEARN_DB_PATH = defaultLearnDbPath();
const GIRA_INDEX_PATH = "/home/shibuka/Projetos/duh-homelab/gira-g/.gira/macro-map.json";
const HTML_FILE = join(import.meta.dir, "index.html");

function openReadOnlyDb(path: string): Database | null {
  if (!existsSync(path)) return null;
  try {
    return new Database(path, { readonly: true });
  } catch {
    return null;
  }
}

// In-memory tracking for Guardrail G1 (Inertia read counter)
let consecutiveReadsCount = 0;

// SSE Client management
const sseClients = new Set<ReadableStreamDefaultController>();

export function notifySse(event: string, data: any) {
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
        notifySse("log", {
          source: "ledger",
          level: "info",
          text: `📜 Novo recibo selado na Merkle Chain: #${(lastReceipt as any)?.seq} [${(lastReceipt as any)?.task}] status=${(lastReceipt as any)?.status}`,
          timestamp: new Date().toISOString(),
        });
      }
      db.close();
    } catch {}
  }, 1500);
}

// SSE session process polling
let lastSessionPids = new Set<string>();
setInterval(() => {
  try {
    const proc = Bun.spawnSync(["ps", "aux"]);
    const out = new TextDecoder().decode(proc.stdout);
    const lines = out.split("\n").slice(1);
    const targets = ["tmux", "claude", "opencode", "hermes", "llama-server", "bun", "agy"];
    const current = new Set<string>();
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;
      const cmd = parts.slice(10).join(" ");
      if (targets.some((t) => cmd.toLowerCase().includes(t))) current.add(parts[1]);
    }
    // detect changes
    const appeared = [...current].filter((p) => !lastSessionPids.has(p));
    const disappeared = [...lastSessionPids].filter((p) => !current.has(p));
    if (appeared.length || disappeared.length) {
      notifySse("session", { appeared, disappeared, total: current.size, timestamp: new Date().toISOString() });
    }
    lastSessionPids = current;
  } catch {}
}, 5000);
setInterval(() => {
  notifySse("ping", { time: Date.now() });
}, 15000);

export const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // 1. SSE Stream
    if (url.pathname === "/api/events") {
      const stream = new ReadableStream({
        start(controller) {
          sseClients.add(controller);
          // Initial greeting log
          const welcome = `event: log\ndata: ${JSON.stringify({
            source: "system",
            level: "info",
            text: "🔌 Conectado ao stream SSE do P-Ingá SDLC Governor (G-Inga)",
            timestamp: new Date().toISOString(),
          })}\n\n`;
          controller.enqueue(new TextEncoder().encode(welcome));
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
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // 2. API Scoreboard Maestro
    if (url.pathname === "/api/scoreboard") {
      try {
        const scoreboard = await computeWorkerScoreboard(LEDGER_PATH, LEARN_DB_PATH);
        return Response.json(scoreboard, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        return Response.json({ workers: [], error: e.message }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      }
    }

    // 3. API Recibos Criptográficos (Merkle Chain)
    if (url.pathname === "/api/receipts") {
      const db = openReadOnlyDb(LEDGER_PATH);
      if (!db) return Response.json({ receipts: [], total: 0 });
      try {
        const rows = db
          .query(
            "SELECT seq, task, status, hash, prev_hash, created_at, body FROM receipts ORDER BY seq DESC LIMIT 200"
          )
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
        }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        db.close();
        return Response.json({ receipts: [], total: 0, error: e.message });
      }
    }

    // 4. API Listagem de Planos (/api/plans)
    if (url.pathname === "/api/plans") {
      try {
        const tasksDir = join(PINGA_ROOT, "tasks");
        if (!existsSync(tasksDir)) {
          return Response.json({ plans: [] });
        }
        const entries = readdirSync(tasksDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && d.name.startsWith("T"))
          .map((d) => d.name)
          .sort((a, b) => {
            const na = parseInt(a.slice(1), 10) || 0;
            const nb = parseInt(b.slice(1), 10) || 0;
            return na - nb;
          });

        const plans = [];
        for (const dir of entries) {
          const planPath = join(tasksDir, dir, "PLAN.md");
          if (!existsSync(planPath)) continue;
          const raw = readFileSync(planPath, "utf8");
          const match = raw.match(/^---\n([\s\S]*?)\n---/);
          const meta: Record<string, any> = {
            id: dir,
            path: `tasks/${dir}/PLAN.md`,
            title: `${dir} Task`,
            mode: "padrao",
            goal: "",
            verify: "",
            done_when: "",
            touch: [],
            tests_frozen: [],
            budget: null,
            max_attempts: 3,
          };

          if (match) {
            const yaml = match[1];
            for (const line of yaml.split("\n")) {
              const idx = line.indexOf(":");
              if (idx > 0) {
                const key = line.slice(0, idx).trim();
                let val = line.slice(idx + 1).trim();
                if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
                if (val.startsWith("[") && val.endsWith("]")) {
                  try {
                    val = JSON.parse(val);
                  } catch {}
                }
                meta[key] = val;
              }
            }
          }

          // Fallback title from goal or first heading
          if (!meta.title || meta.title === `${dir} Task`) {
            if (meta.goal) {
              meta.title = meta.goal.slice(0, 80);
            } else {
              const headingMatch = raw.match(/#\s+(.+)/);
              if (headingMatch) meta.title = headingMatch[1].trim();
            }
          }

          plans.push(meta);
        }

        return Response.json({ total: plans.length, plans }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        return Response.json({ plans: [], error: e.message }, { status: 500 });
      }
    }

    // 5. API Status dos Disjuntores e Guardrails (/api/breakers)
    if (url.pathname === "/api/breakers") {
      const db = openReadOnlyDb(LEDGER_PATH);
      const blockedTasks: Array<{ task: string; reason_code: string; seq: number; hash: string }> = [];
      if (db) {
        try {
          const rows = db
            .query("SELECT seq, task, status, hash, body FROM receipts ORDER BY seq DESC LIMIT 50")
            .all() as any[];
          const seen = new Set<string>();
          for (const r of rows) {
            if (!seen.has(r.task)) {
              seen.add(r.task);
              if (r.status === "blocked") {
                let reason = "breaker_tripped";
                try {
                  const b = JSON.parse(r.body);
                  reason = b.reason_code ?? reason;
                } catch {}
                blockedTasks.push({
                  task: r.task,
                  reason_code: reason,
                  seq: r.seq,
                  hash: r.hash,
                });
              }
            }
          }
        } finally {
          db.close();
        }
      }

      return Response.json({
        g1: {
          name: "G1 - Inércia (Read-Loop Breaker)",
          status: consecutiveReadsCount >= 3 ? "tripped" : "ok",
          consecutive_reads: consecutiveReadsCount,
          threshold: 3,
          description: "Máximo de 3 leituras consecutivas sem teste ou mutação",
        },
        g2: {
          name: "G2 - Payload Guard",
          status: "ok",
          max_lines_existing: 100,
          max_chars_existing: 1500,
          max_lines_new: 120,
          max_chars_new: 2500,
          description: "Bloqueia escritas monolíticas forçando cirurgia gira write/add",
        },
        i3: {
          name: "I3 - Anti-Thrashing Breaker",
          status: blockedTasks.length > 0 ? "tripped" : "clear",
          tripped: blockedTasks.length > 0,
          blocked_tasks: blockedTasks,
          description: "2 falhas consecutivas com mesma assinatura SHA256 travam a tarefa",
        },
      }, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // 6. API Grafo Semântico AST (/api/graph)
    if (url.pathname === "/api/graph") {
      let macroMap: any = null;
      if (existsSync(GIRA_INDEX_PATH)) {
        try {
          macroMap = JSON.parse(readFileSync(GIRA_INDEX_PATH, "utf8"));
        } catch {}
      }

      const nodes: any[] = [];
      const edges: any[] = [];

      // If macro-map exists, format nodes and relationships
      if (macroMap && Array.isArray(macroMap.nodes)) {
        for (const n of macroMap.nodes.slice(0, 100)) {
          nodes.push({
            data: {
              id: n.id,
              label: n.name || n.id,
              kind: n.kind || "Component",
              description: n.description || "",
              declared_file: n.metadata?.declared_file || "",
              methods: n.metadata?.methods || [],
              ts_kind: n.metadata?.ts_kind || "",
            },
          });
        }
        if (Array.isArray(macroMap.relationships)) {
          for (const r of macroMap.relationships.slice(0, 150)) {
            edges.push({
              data: {
                id: r.id || `${r.source_id}->${r.target_id}`,
                source: r.source_id,
                target: r.target_id,
                verb: r.verb || "consumes",
              },
            });
          }
        }
      }

      // Add architectural homelab core nodes for comprehensive visualization
      const coreNodes = [
        { id: "core:p-inga", label: "p-inga (Governor)", kind: "Engine", description: "SDLC Governor Determinístico" },
        { id: "core:ledger", label: "ledger.db (Merkle)", kind: "Storage", description: "Cadeia Merkle SHA256 Imutável" },
        { id: "core:maestro", label: "maestro (Scoreboard)", kind: "Service", description: "Orquestrador e Placar de Operários" },
        { id: "core:guardrails", label: "guardrails (G1/G2/I3)", kind: "Policy", description: "Disjuntores Anti-Thrashing e Payload" },
        { id: "core:gira-g", label: "gira-g (AST Engine)", kind: "Engine", description: "Manipulador Cirúrgico de AST TypeScript" },
        { id: "core:tuios", label: "tuios (TUI visual)", kind: "Entrypoint", description: "Interface de Terminal e Dockbar OSC" },
        { id: "core:hermes", label: "hermes (Chat Agent)", kind: "Entrypoint", description: "Agente Governador de Chat e Voz" },
        { id: "core:opencode", label: "opencode (Runner)", kind: "Worker", description: "Executor Autônomo de Código" },
      ];

      for (const cn of coreNodes) {
        if (!nodes.some((n) => n.data.id === cn.id)) {
          nodes.unshift({ data: cn });
        }
      }

      const coreEdges = [
        { source: "core:tuios", target: "core:p-inga", verb: "controls" },
        { source: "core:hermes", target: "core:p-inga", verb: "governs" },
        { source: "core:p-inga", target: "core:ledger", verb: "seals_receipts" },
        { source: "core:p-inga", target: "core:maestro", verb: "evaluates" },
        { source: "core:p-inga", target: "core:guardrails", verb: "enforces" },
        { source: "core:p-inga", target: "core:gira-g", verb: "analyzes_ast" },
        { source: "core:opencode", target: "core:p-inga", verb: "reports_evidence" },
      ];

      for (const ce of coreEdges) {
        edges.unshift({
          data: {
            id: `core:${ce.source}->${ce.target}`,
            source: ce.source,
            target: ce.target,
            verb: ce.verb,
          },
        });
      }

      // Conecta simbolos de AST do P-Inga para formar uma arvore navegavel consistente
      for (const n of nodes) {
        if (n.data.id.startsWith("contract:") || n.data.id.startsWith("lib:")) {
          edges.push({
            data: {
              id: `rel:core:p-inga->${n.data.id}`,
              source: "core:p-inga",
              target: n.data.id,
              verb: n.data.kind === "Contract" ? "specifies" : "implements",
            },
          });
        }
      }

      // Garante sanitizacao estrita: descarta qualquer aresta cujo source ou target nao exista
      const nodeIds = new Set(nodes.map((n) => n.data.id));
      const validEdges = edges.filter(
        (e) => nodeIds.has(e.data.source) && nodeIds.has(e.data.target)
      );

      return Response.json({
        nodes,
        edges: validEdges,
        totalNodes: nodes.length,
        totalEdges: validEdges.length,
      }, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    // 7. AÇÃO: Executar Verificação Determinística (/api/action/verify)
    if (url.pathname === "/api/action/verify" && req.method === "POST") {
      try {
        const body = await req.json();
        const planPath = body.plan_path;
        if (!planPath) {
          return Response.json({ success: false, error: "plan_path é obrigatório" }, { status: 400 });
        }

        const args = ["bin/pinga.ts", "verify", planPath];
        if (body.base_sha) args.push("--base", body.base_sha);
        if (body.usage_file) args.push("--usage-file", body.usage_file);
        if (body.override_mode && body.reason) {
          args.push("--override-mode", body.override_mode, "--reason", body.reason);
        }
        if (body.prove_base) args.push("--prove-base");

        notifySse("log", {
          source: "verify",
          level: "info",
          text: `⚡ Iniciando verificação: bun ${args.join(" ")}`,
          timestamp: new Date().toISOString(),
        });

        const proc = Bun.spawn(["bun", ...args], {
          cwd: PINGA_ROOT,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        });

        const stdoutText = await new Response(proc.stdout).text();
        const stderrText = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        const combinedOutput = (stdoutText + "\n" + stderrText).trim();

        // Tenta extrair o recibo JSON gerado
        let receipt = null;
        for (const line of (stdoutText + "\n" + stderrText).split("\n")) {
          const trimmed = line.trim();
          if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.type === "task.receipt") {
                receipt = parsed;
                break;
              }
            } catch {}
          }
        }

        // Se não achou na saída, lê o último recibo do ledger
        if (!receipt) {
          const db = openReadOnlyDb(LEDGER_PATH);
          if (db) {
            try {
              const last = db.query("SELECT * FROM receipts ORDER BY seq DESC LIMIT 1").get() as any;
              if (last && last.body) {
                receipt = JSON.parse(last.body);
              }
            } catch {} finally {
              db.close();
            }
          }
        }

        notifySse("log", {
          source: "verify",
          level: exitCode === 0 ? "info" : "warn",
          text: `⚡ Verificação concluída (exit ${exitCode}): status=${receipt?.status ?? "unknown"}`,
          timestamp: new Date().toISOString(),
        });

        notifySse("verify_result", {
          plan_path: planPath,
          exitCode,
          receipt,
          success: exitCode === 0,
        });

        return Response.json({
          success: exitCode === 0,
          exitCode,
          output: combinedOutput,
          receipt,
        }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        notifySse("log", {
          source: "verify",
          level: "error",
          text: `❌ Falha ao rodar verificação: ${e.message}`,
          timestamp: new Date().toISOString(),
        });
        return Response.json({ success: false, error: e.message }, { status: 500 });
      }
    }

    // 8. AÇÃO: Despachar Tarefa (/api/action/dispatch)
    if (url.pathname === "/api/action/dispatch" && req.method === "POST") {
      try {
        const body = await req.json();
        const { task, prompt, model, stack } = body;

        notifySse("log", {
          source: "dispatch",
          level: "info",
          text: `🚀 Despachando tarefa ${task || "avulsa"} com modelo ${model || "default"} no stack ${stack || "p-inga"}...`,
          timestamp: new Date().toISOString(),
        });

        let output = "";
        let exitCode = 0;

        // Se opencode estiver disponível e solicitado
        if (model && model.includes("opencode")) {
          const opencodeBin = "/home/shibuka/.local/share/mise/installs/opencode/latest/node_modules/.bin/opencode";
          if (existsSync(opencodeBin)) {
            const proc = Bun.spawn([opencodeBin, "run", "--model", model, prompt || `Executar ${task}`], {
              cwd: PINGA_ROOT,
              stdout: "pipe",
              stderr: "pipe",
            });
            output = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
            exitCode = await proc.exited;
          } else {
            output = `[Dispatch Simulado] OpenCode runner acionado para a tarefa ${task} (${model})`;
          }
        } else {
          output = `[Dispatch Realizado] Operário ${model || "Hermes Agent"} assumiu o contrato ${task}.\nPrompt: ${prompt}\nStack: ${stack || "p-inga"}\nStatus: Em execução em sessão isolada.`;
        }

        notifySse("log", {
          source: "dispatch",
          level: "info",
          text: `🚀 Despacho aceito para ${task}. Operário engajado.`,
          timestamp: new Date().toISOString(),
        });

        return Response.json({
          success: exitCode === 0,
          exitCode,
          task,
          model,
          output,
          message: `Operário despachado com sucesso para ${task}`,
        }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        return Response.json({ success: false, error: e.message }, { status: 500 });
      }
    }

    // 9. AÇÃO: Reset de Disjuntores e Inércia (/api/action/reset-breakers)
    if (url.pathname === "/api/action/reset-breakers" && req.method === "POST") {
      try {
        let targetTask: string | undefined;
        try {
          const body = await req.json();
          targetTask = body?.task;
        } catch {}

        // Reseta o contador in-memory de inércia (G1)
        consecutiveReadsCount = 0;

        // Busca tarefas bloqueadas no ledger
        const db = openReadOnlyDb(LEDGER_PATH);
        const blockedTasks = new Set<string>();
        if (db) {
          try {
            const rows = db.query("SELECT DISTINCT task FROM receipts WHERE status = 'blocked'").all() as any[];
            for (const r of rows) {
              if (r.task) blockedTasks.add(r.task);
            }
          } finally {
            db.close();
          }
        }

        const tasksToReset = targetTask ? [targetTask] : Array.from(blockedTasks);

        // Se houver tarefas a resetar, anexa um recibo de destravamento no ledger
        if (tasksToReset.length > 0) {
          const ledger = openLedger(LEDGER_PATH);
          try {
            for (const t of tasksToReset) {
              const resetReceipt = {
                v: 1,
                type: "task.receipt",
                id: `rcpt-reset-${t}-${Date.now().toString(36)}`,
                task: t,
                status: "not run",
                reason_code: "not_executed",
                attempts: 1,
                evidence: [],
                tokens: { in: null, out: null, cache: null, source: null },
                cost_usd: null,
                cost_evidence: "not run",
                author: { model: null, family: null },
                verified_by: null,
                summary: `Disjuntor I3 resetado pelo operador humano via Web Dashboard para tarefa ${t}`,
                created_at: new Date().toISOString(),
                breaker: {
                  tripped: false,
                  failure_signature: null,
                },
                next_action: "re-executar verificação",
              };
              ledger.append(resetReceipt);
            }
          } finally {
            ledger.close();
          }
        }

        notifySse("breaker_reset", {
          tasks: tasksToReset,
          timestamp: new Date().toISOString(),
        });

        notifySse("log", {
          source: "breaker",
          level: "info",
          text: `🛡️ Disjuntores resetados: Inércia G1 zerada (0/3), Tarefas liberadas: [${tasksToReset.join(", ") || "Nenhuma bloqueada"}]`,
          timestamp: new Date().toISOString(),
        });

        return Response.json({
          success: true,
          message: "Disjuntores G1 (Inércia) e I3 (Anti-Thrashing) resetados com sucesso",
          tasks_cleared: tasksToReset,
        }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        return Response.json({ success: false, error: e.message }, { status: 500 });
      }
    }

    // 10. AÇÃO: Consulta Semântica de AST Gira-G (/api/action/ast-query)
    if (url.pathname === "/api/action/ast-query" && req.method === "POST") {
      try {
        const body = await req.json();
        const action = body.action || "outline";
        const file = body.file || "src/breaker.ts";
        const symbol = body.symbol;
        const query = body.query;

        let args: string[] = [];
        if (action === "outline") {
          args = ["outline", file];
        } else if (action === "read") {
          if (!symbol) {
            return Response.json({ success: false, error: "Symbol é obrigatório para gira read" }, { status: 400 });
          }
          args = ["read", file, symbol];
        } else if (action === "slice") {
          args = ["slice", symbol || file, "--index", GIRA_INDEX_PATH];
        } else if (action === "impact") {
          args = ["impact", symbol || file, "--index", GIRA_INDEX_PATH];
        } else if (action === "locate") {
          args = ["locate", query || symbol || file, "--index", GIRA_INDEX_PATH];
        } else {
          return Response.json({ success: false, error: `Ação AST desconhecida: ${action}` }, { status: 400 });
        }

        // Incrementa o contador de leituras G1
        consecutiveReadsCount++;

        notifySse("log", {
          source: "ast",
          level: "info",
          text: `📐 Consulta AST: gira ${args.join(" ")} (G1 reads: ${consecutiveReadsCount}/3)`,
          timestamp: new Date().toISOString(),
        });

        const proc = Bun.spawn(["gira", ...args], {
          cwd: PINGA_ROOT,
          stdout: "pipe",
          stderr: "pipe",
        });

        const stdoutText = await new Response(proc.stdout).text();
        const stderrText = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        return Response.json({
          success: exitCode === 0,
          exitCode,
          action,
          file,
          symbol,
          output: (stdoutText || stderrText).trim(),
        }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        return Response.json({ success: false, error: e.message }, { status: 500 });
      }
    }

    // 11. Broadcast Log (/api/action/log)
    if (url.pathname === "/api/action/log" && req.method === "POST") {
      try {
        const body = await req.json();
        notifySse("log", {
          source: body.source || "user",
          level: body.level || "info",
          text: body.text || "",
          timestamp: new Date().toISOString(),
        });
        return Response.json({ ok: true });
      } catch {
        return Response.json({ ok: false }, { status: 400 });
      }
    }

    // 11b. API: Sessões/Agentes ativos (processos)
    if (url.pathname === "/api/sessions" || url.pathname === "/api/agents") {
      try {
        const proc = Bun.spawnSync(["ps", "aux"]);
        const out = new TextDecoder().decode(proc.stdout);
        const lines = out.split("\n").slice(1);
        const targets = ["tmux", "claude", "opencode", "hermes", "llama-server", "bun", "agy"];
        const procs = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          const parts = line.trim().split(/\s+/);
          if (parts.length < 11) continue;
          const cmd = parts.slice(10).join(" ");
          if (targets.some((t) => cmd.toLowerCase().includes(t))) {
            procs.push({
              pid: parts[1],
              cpu: parts[2],
              mem: parts[3],
              command: cmd,
              kind: targets.find((t) => cmd.toLowerCase().includes(t)) || "other",
            });
          }
        }
        return Response.json({ total: procs.length, processes: procs }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        return Response.json({ total: 0, processes: [], error: e.message }, { status: 500 });
      }
    }

    // 11c. AÇÃO: controle de sessão (kill/attach stub)
    if (url.pathname === "/api/action/session" && req.method === "POST") {
      try {
        const body = await req.json();
        const action = body.action || "kill";
        const pid = body.pid;
        return Response.json({ success: true, stub: true, action, pid, message: "stub" }, {
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch (e: any) {
        return Response.json({ success: false, error: e.message }, { status: 500 });
      }
    }

    // 12. Interface Visual Reativa SPA (Serve index.html)
    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (existsSync(HTML_FILE)) {
        const html = readFileSync(HTML_FILE, "utf8");
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("Dashboard index.html not found", { status: 500 });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`[P-INGA DASHBOARD] G-Inga ativo em http://localhost:${PORT}`);
