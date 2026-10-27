import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultLearnDbPath } from "../src/learn";
import { defaultLedgerPath, openLedger } from "../src/ledger";
import { computeWorkerScoreboard } from "../src/maestro";

export type DashboardConfig = {
  /** Porta TCP; 0 pede porta efêmera ao kernel. */
  port: number;
  /** Raiz do repositório p-inga usada para ler tasks/ e rodar a CLI. */
  root: string;
  ledgerPath: string;
  learnDbPath: string;
  giraIndexPath: string;
  htmlFile: string;
  opencodeBin: string;
  bunBin: string;
};

export type DashboardPanel = {
  server: ReturnType<typeof Bun.serve>;
  port: number;
  /** Fecha conexões, limpa timers e libera a porta. Idempotente. */
  stop: () => void;
};

const HISTORY_TARGETS = ["tmux", "claude", "opencode", "hermes", "llama-server", "bun", "agy"];

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Configuração do painel resolvida a partir do ambiente.
 * Nada é lido de variáveis globais dentro do servidor: tudo passa por aqui,
 * para que testes possam subir instâncias isoladas em paralelo.
 */
export function readDashboardConfig(
  env: Record<string, string | undefined> = process.env,
  rootOverride?: string,
): DashboardConfig {
  const root = resolve(env.PINGA_ROOT ?? rootOverride ?? resolve(import.meta.dir, ".."));
  const home = env.HOME ?? root;
  const stateHome = env.XDG_STATE_HOME ?? join(home, ".local", "state");
  return {
    port: Number(env.PINGA_WEB_PORT ?? 4242),
    root,
    ledgerPath:
      env.LEDGER_PATH ?? defaultLedgerPath({ ...env, HOME: home, XDG_STATE_HOME: stateHome }),
    learnDbPath: defaultLearnDbPath({ ...env, HOME: home, XDG_STATE_HOME: stateHome }),
    // Default portátil: relativo à raiz do projeto (resolvido no uso), nunca
    // um caminho absoluto de máquina.
    giraIndexPath: env.GIRA_MAP ?? env.PINGA_GIRA_INDEX ?? join("..", "gira-g", ".gira", "macro-map.json"),
    htmlFile: env.PINGA_HTML_FILE ?? join(import.meta.dir, "index.html"),
    // Nome puro resolve pelo PATH: nenhum caminho de máquina fica cravado.
    opencodeBin: env.OPENCODE_BIN ?? "opencode",
    bunBin: env.PINGA_BUN ?? process.execPath,
  };
}

/** Estado do ledger exposto ao painel: presença, caminho e como corrigir. */
export function describeLedger(cfg: DashboardConfig): {
  present: boolean;
  path: string;
  hint: string;
} {
  const present = existsSync(cfg.ledgerPath);
  return {
    present,
    path: cfg.ledgerPath,
    hint: present
      ? "ledger encontrado"
      : `ledger ausente em ${cfg.ledgerPath} — rode \`pinga verify <plan>\` para selar o primeiro recibo, ou aponte PINGA_LEDGER para outro arquivo`,
  };
}

export function createDashboardServer(cfg: DashboardConfig): DashboardPanel {
  const sseClients = new Set<ReadableStreamDefaultController>();
  const timers: Array<ReturnType<typeof setInterval>> = [];
  // Contador em memória do guardrail G1 (Inércia).
  let consecutiveReadsCount = 0;
  const heartbeatTimers = new Map<ReadableStreamDefaultController<Uint8Array>, ReturnType<typeof setInterval>>();

  // Caminho efetivo do macro-map: default relativo resolve contra a raiz.
  const giraMapPath = resolve(cfg.root, cfg.giraIndexPath);

  function openReadOnlyDb(path: string): Database | null {
    if (!existsSync(path)) return null;
    try {
      return new Database(path, { readonly: true });
    } catch (err) {
      console.error(`[p-inga web] ledger ilegível em ${path}: ${errText(err)}`);
      return null;
    }
  }

  function notifySse(event: string, data: unknown) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.enqueue(new TextEncoder().encode(payload));
      } catch (err) {
        console.error(`[p-inga web] cliente SSE descartado: ${errText(err)}`);
        sseClients.delete(client);
      }
    }
  }

  // Watcher do ledger para envio reativo via SSE.
  if (existsSync(cfg.ledgerPath)) {
    let lastCount = 0;
    timers.push(
      setInterval(() => {
        const db = openReadOnlyDb(cfg.ledgerPath);
        if (!db) return;
        try {
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
        } catch (err) {
          notifySse("log", {
            source: "ledger",
            level: "error",
            text: `watcher do ledger falhou: ${errText(err)}`,
            timestamp: new Date().toISOString(),
          });
        } finally {
          db.close();
        }
      }, 1500),
    );
  }

  // Polling de processos: alimenta o evento SSE "session".
  let lastSessionPids = new Set<string>();
  function scanProcesses(): Array<{
    pid: string;
    cpu: string;
    mem: string;
    command: string;
    kind: string;
  }> {
    const proc = Bun.spawnSync(["ps", "aux"]);
    const out = new TextDecoder().decode(proc.stdout);
    const procs = [];
    for (const line of out.split("\n").slice(1)) {
      if (!line.trim()) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 11) continue;
      const cmd = parts.slice(10).join(" ");
      const kind = HISTORY_TARGETS.find((t) => cmd.toLowerCase().includes(t));
      if (!kind) continue;
      procs.push({ pid: parts[1], cpu: parts[2], mem: parts[3], command: cmd, kind });
    }
    return procs;
  }

  timers.push(
    setInterval(() => {
      try {
        const current = new Set(scanProcesses().map((p) => p.pid));
        const appeared = [...current].filter((p) => !lastSessionPids.has(p));
        const disappeared = [...lastSessionPids].filter((p) => !current.has(p));
        if (appeared.length || disappeared.length) {
          notifySse("session", {
            appeared,
            disappeared,
            total: current.size,
            timestamp: new Date().toISOString(),
          });
        }
        lastSessionPids = current;
      } catch (err) {
        console.error(`[p-inga web] varredura de processos falhou: ${errText(err)}`);
      }
    }, 5000),
  );
  timers.push(setInterval(() => notifySse("ping", { time: Date.now() }), 15000));

  const readingsPath = join(cfg.root, ".pinga", "readings.json");

  function loadPersistedReads(): number {
    try {
      if (!existsSync(readingsPath)) return 0;
      const parsed = JSON.parse(readFileSync(readingsPath, "utf8")) as { consecutive_reads?: number };
      const value = Number(parsed.consecutive_reads ?? 0);
      return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch (err) {
      console.error(`[p-inga web] readings.json ilegível (${readingsPath}): ${errText(err)}`);
      return 0;
    }
  }

  function persistReads(): void {
    try {
      const dir = join(cfg.root, ".pinga");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(
        readingsPath,
        JSON.stringify({ consecutive_reads: consecutiveReadsCount, updated_at: new Date().toISOString() }, null, 2),
      );
    } catch (err) {
      console.error(`[p-inga web] não consegui persistir ${readingsPath}: ${errText(err)}`);
    }
  }

  consecutiveReadsCount = loadPersistedReads();

  const server = Bun.serve({
    port: cfg.port,
    async fetch(req) {
      const url = new URL(req.url);

      // CORS restrito: só a própria origem do painel. Nada de curinga.
      const origin = req.headers.get("origin");
      const ownOrigins = new Set([`http://127.0.0.1:${server.port}`, `http://localhost:${server.port}`]);
      const originAllowed = origin === null || ownOrigins.has(origin);
      if (!originAllowed && req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
        return Response.json(
          { success: false, error: `origem não autorizada: ${origin} (painel aceita ${[...ownOrigins].join(", ")})` },
          { status: 403 },
        );
      }
      const cors: Record<string, string> = originAllowed && origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};

      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            ...cors,
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // 1. Stream SSE
      if (url.pathname === "/api/events") {
        const stream = new ReadableStream({
          start(controller) {
            sseClients.add(controller);
            const heartbeat = setInterval(() => {
              try {
                controller.enqueue(
                  new TextEncoder().encode(
                    `event: heartbeat\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`,
                  ),
                );
              } catch (err) {
                clearInterval(heartbeat);
                heartbeatTimers.delete(controller);
                console.error(`[p-inga web] heartbeat SSE encerrado: ${errText(err)}`);
              }
            }, 2000);
            heartbeatTimers.set(controller, heartbeat);
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
            const heartbeat = heartbeatTimers.get(controller);
            if (heartbeat) clearInterval(heartbeat);
            heartbeatTimers.delete(controller);
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            ...cors,
          },
        });
      }

      // 2. Scoreboard do maestro
      if (url.pathname === "/api/scoreboard") {
        try {
          const scoreboard = await computeWorkerScoreboard(cfg.ledgerPath, cfg.learnDbPath);
          return Response.json(scoreboard, { headers: cors });
        } catch (err) {
          return Response.json({ workers: [], error: errText(err) }, { headers: cors });
        }
      }

      // 3. Recibos da Merkle Chain — ausência de ledger é estado explícito.
      if (url.pathname === "/api/receipts") {
        const ledger = describeLedger(cfg);
        const db = openReadOnlyDb(cfg.ledgerPath);
        if (!db) return Response.json({ receipts: [], total: 0, ledger }, { headers: cors });
        try {
          const rows = db
            .query(
              "SELECT seq, task, status, hash, prev_hash, created_at, body FROM receipts ORDER BY seq DESC LIMIT 200",
            )
            .all() as any[];
          return Response.json(
            {
              total: rows.length,
              ledger,
              receipts: rows.map((r) => {
                let parsed = null;
                try {
                  parsed = JSON.parse(r.body);
                } catch (err) {
                  parsed = { parse_error: errText(err), raw: r.body };
                }
                return { ...r, parsed };
              }),
            },
            { headers: cors },
          );
        } catch (err) {
          return Response.json(
            { receipts: [], total: 0, ledger, error: errText(err) },
            { headers: cors },
          );
        } finally {
          db.close();
        }
      }

      // 4. Planos em tasks/
      if (url.pathname === "/api/plans") {
        try {
          const tasksDir = join(cfg.root, "tasks");
          if (!existsSync(tasksDir)) {
            return Response.json({ plans: [] }, { headers: cors });
          }
          const entries = readdirSync(tasksDir, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith("T"))
            .map((d) => d.name)
            .sort((a, b) => (parseInt(a.slice(1), 10) || 0) - (parseInt(b.slice(1), 10) || 0));

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
              for (const line of match[1].split("\n")) {
                const idx = line.indexOf(":");
                if (idx <= 0) continue;
                const key = line.slice(0, idx).trim();
                let val: any = line.slice(idx + 1).trim();
                if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
                if (val.startsWith("[") && val.endsWith("]")) {
                  try {
                    val = JSON.parse(val);
                  } catch (err) {
                    meta.parse_warnings = [
                      ...(meta.parse_warnings ?? []),
                      `campo ${key} não é lista JSON válida: ${errText(err)}`,
                    ];
                  }
                }
                meta[key] = val;
              }
            }

            if (!meta.title || meta.title === `${dir} Task`) {
              if (meta.goal) meta.title = String(meta.goal).slice(0, 80);
              else {
                const headingMatch = raw.match(/#\s+(.+)/);
                if (headingMatch) meta.title = headingMatch[1].trim();
              }
            }

            plans.push(meta);
          }

          return Response.json({ total: plans.length, plans }, { headers: cors });
        } catch (err) {
          return Response.json({ plans: [], error: errText(err) }, { status: 500, headers: cors });
        }
      }

      // 5. Disjuntores e guardrails
      if (url.pathname === "/api/breakers") {
        const db = openReadOnlyDb(cfg.ledgerPath);
        const blockedTasks: Array<{
          task: string;
          reason_code: string;
          seq: number;
          hash: string;
        }> = [];
        if (db) {
          try {
            const rows = db
              .query("SELECT seq, task, status, hash, body FROM receipts ORDER BY seq DESC LIMIT 50")
              .all() as any[];
            const seen = new Set<string>();
            for (const r of rows) {
              if (seen.has(r.task)) continue;
              seen.add(r.task);
              if (r.status !== "blocked") continue;
              let reason = "breaker_tripped";
              try {
                reason = JSON.parse(r.body).reason_code ?? reason;
              } catch (err) {
                reason = `breaker_tripped (corpo ilegível: ${errText(err)})`;
              }
              blockedTasks.push({ task: r.task, reason_code: reason, seq: r.seq, hash: r.hash });
            }
          } finally {
            db.close();
          }
        }

        return Response.json(
          {
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
          },
          { headers: cors },
        );
      }

      // 6. Grafo semântico AST
      if (url.pathname === "/api/graph") {
        let macroMap: any = null;
        if (existsSync(giraMapPath)) {
          try {
            macroMap = JSON.parse(readFileSync(giraMapPath, "utf8"));
          } catch (err) {
            return Response.json(
              { nodes: [], edges: [], error: `macro-map ilegível: ${errText(err)}` },
              { status: 500, headers: cors },
            );
          }
        }

        const nodes: any[] = [];
        const edges: any[] = [];

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

        const coreNodes = [
          {
            id: "core:p-inga",
            label: "p-inga (Governor)",
            kind: "Engine",
            description: "SDLC Governor Determinístico",
          },
          {
            id: "core:ledger",
            label: "ledger.db (Merkle)",
            kind: "Storage",
            description: "Cadeia Merkle SHA256 Imutável",
          },
          {
            id: "core:maestro",
            label: "maestro (Scoreboard)",
            kind: "Service",
            description: "Orquestrador e Placar de Operários",
          },
          {
            id: "core:guardrails",
            label: "guardrails (G1/G2/I3)",
            kind: "Policy",
            description: "Disjuntores Anti-Thrashing e Payload",
          },
          {
            id: "core:gira-g",
            label: "gira-g (AST Engine)",
            kind: "Engine",
            description: "Manipulador Cirúrgico de AST TypeScript",
          },
          {
            id: "core:tuios",
            label: "tuios (TUI visual)",
            kind: "Entrypoint",
            description: "Interface de Terminal e Dockbar OSC",
          },
          {
            id: "core:hermes",
            label: "hermes (Chat Agent)",
            kind: "Entrypoint",
            description: "Agente Governador de Chat e Voz",
          },
          {
            id: "core:opencode",
            label: "opencode (Runner)",
            kind: "Worker",
            description: "Executor Autônomo de Código",
          },
        ];

        for (const cn of coreNodes) {
          if (!nodes.some((n) => n.data.id === cn.id)) nodes.unshift({ data: cn });
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

        const nodeIds = new Set(nodes.map((n) => n.data.id));
        const validEdges = edges.filter(
          (e) => nodeIds.has(e.data.source) && nodeIds.has(e.data.target),
        );

        return Response.json(
          {
            nodes,
            edges: validEdges,
            totalNodes: nodes.length,
            totalEdges: validEdges.length,
            source: macroMap ? giraMapPath : "builtin",
            warning: macroMap
              ? undefined
              : `mapa gira ausente em ${giraMapPath} — exibindo grafo mínimo embutido (defina GIRA_MAP)`,
          },
          { headers: cors },
        );
      }

      // 7. AÇÃO: verificação determinística
      if (url.pathname === "/api/action/verify" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch (err) {
          return Response.json(
            { success: false, error: `corpo JSON inválido em /api/action/verify: ${errText(err)}` },
            { status: 500, headers: cors },
          );
        }

        try {
          const planPath = body?.plan_path;
          if (!planPath) {
            return Response.json(
              { success: false, error: "plan_path é obrigatório" },
              { status: 400, headers: cors },
            );
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

          const proc = Bun.spawn([cfg.bunBin, ...args], {
            cwd: cfg.root,
            stdout: "pipe",
            stderr: "pipe",
            env: { ...process.env },
          });

          const stdoutText = await new Response(proc.stdout).text();
          const stderrText = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;
          const combinedOutput = (stdoutText + "\n" + stderrText).trim();

          let receipt: any = null;
          for (const line of combinedOutput.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) continue;
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed.type === "task.receipt") {
                receipt = parsed;
                break;
              }
            } catch (err) {
              console.error(`[p-inga web] linha JSON inválida na saída do verify: ${errText(err)}`);
            }
          }

          if (!receipt) {
            const db = openReadOnlyDb(cfg.ledgerPath);
            if (db) {
              try {
                const last = db.query("SELECT * FROM receipts ORDER BY seq DESC LIMIT 1").get() as any;
                if (last?.body) receipt = JSON.parse(last.body);
              } catch (err) {
                console.error(`[p-inga web] último recibo ilegível: ${errText(err)}`);
              } finally {
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

          return Response.json(
            { success: exitCode === 0, exitCode, output: combinedOutput, receipt },
            { headers: cors },
          );
        } catch (err) {
          notifySse("log", {
            source: "verify",
            level: "error",
            text: `❌ Falha ao rodar verificação: ${errText(err)}`,
            timestamp: new Date().toISOString(),
          });
          return Response.json(
            { success: false, error: `falha ao executar verify: ${errText(err)}` },
            { status: 500, headers: cors },
          );
        }
      }

      // 8. AÇÃO: dispatch de tarefa — sem runner real, é simulação declarada.
      if (url.pathname === "/api/action/dispatch" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch (err) {
          return Response.json(
            { success: false, error: `corpo JSON inválido em /api/action/dispatch: ${errText(err)}` },
            { status: 500, headers: cors },
          );
        }

        const { task, prompt, model, stack } = body ?? {};
        notifySse("log", {
          source: "dispatch",
          level: "info",
          text: `🚀 Despachando tarefa ${task || "avulsa"} com modelo ${model || "default"} no stack ${stack || "p-inga"}...`,
          timestamp: new Date().toISOString(),
        });

        const wantsOpencode = typeof model === "string" && model.includes("opencode");
        if (wantsOpencode && existsSync(cfg.opencodeBin)) {
          try {
            const proc = Bun.spawn(
              [cfg.opencodeBin, "run", "--model", model, prompt || `Executar ${task}`],
              { cwd: cfg.root, stdout: "pipe", stderr: "pipe" },
            );
            const output =
              (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
            const exitCode = await proc.exited;
            return Response.json(
              {
                success: exitCode === 0,
                exitCode,
                task,
                model,
                simulated: false,
                output: output.trim(),
                message:
                  exitCode === 0
                    ? `OpenCode executou ${task}`
                    : `OpenCode terminou com exit ${exitCode} em ${task}`,
              },
              { headers: cors },
            );
          } catch (err) {
            return Response.json(
              { success: false, error: `falha ao invocar OpenCode: ${errText(err)}` },
              { status: 500, headers: cors },
            );
          }
        }

        const reason = wantsOpencode
          ? `binário OpenCode não encontrado em ${cfg.opencodeBin}`
          : `modelo "${model ?? "default"}" não aponta para um runner OpenCode`;
        return Response.json(
          {
            success: true,
            simulated: true,
            exitCode: 0,
            task,
            model,
            output: `[Dispatch Simulado] Nenhum operário foi acionado: ${reason}.\nTarefa: ${task ?? "avulsa"}\nPrompt: ${prompt ?? "(vazio)"}\nStack: ${stack || "p-inga"}`,
            message: `Despacho simulado para ${task ?? "tarefa avulsa"} — nada foi executado`,
          },
          { headers: cors },
        );
      }

      // 9. AÇÃO: reset de disjuntores
      if (url.pathname === "/api/action/reset-breakers" && req.method === "POST") {
        try {
          let targetTask: string | undefined;
          try {
            const body = await req.json();
            targetTask = body?.task;
          } catch (err) {
            console.error(`[p-inga web] corpo do reset-breakers ignorado: ${errText(err)}`);
          }

          consecutiveReadsCount = 0;
          persistReads();

          const db = openReadOnlyDb(cfg.ledgerPath);
          const blocked = new Set<string>();
          if (db) {
            try {
              const rows = db
                .query("SELECT DISTINCT task FROM receipts WHERE status = 'blocked'")
                .all() as any[];
              for (const r of rows) if (r.task) blocked.add(r.task);
            } finally {
              db.close();
            }
          }

          const tasksToReset = targetTask ? [targetTask] : Array.from(blocked);

          if (tasksToReset.length > 0) {
            const ledger = openLedger(cfg.ledgerPath);
            try {
              for (const t of tasksToReset) {
                ledger.append({
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
                  breaker: { tripped: false, failure_signature: null },
                  next_action: "re-executar verificação",
                });
              }
            } finally {
              ledger.close();
            }
          }

          notifySse("breaker_reset", { tasks: tasksToReset, timestamp: new Date().toISOString() });
          notifySse("log", {
            source: "breaker",
            level: "info",
            text: `🛡️ Disjuntores resetados: Inércia G1 zerada (0/3), Tarefas liberadas: [${tasksToReset.join(", ") || "Nenhuma bloqueada"}]`,
            timestamp: new Date().toISOString(),
          });

          return Response.json(
            {
              success: true,
              message: "Disjuntores G1 (Inércia) e I3 (Anti-Thrashing) resetados com sucesso",
              tasks_cleared: tasksToReset,
            },
            { headers: cors },
          );
        } catch (err) {
          return Response.json(
            { success: false, error: `falha ao resetar disjuntores: ${errText(err)}` },
            { status: 500, headers: cors },
          );
        }
      }

      // 10. AÇÃO: consulta AST via gira
      if (url.pathname === "/api/action/ast-query" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch (err) {
          return Response.json(
            { success: false, error: `corpo JSON inválido em /api/action/ast-query: ${errText(err)}` },
            { status: 500, headers: cors },
          );
        }

        const action = body?.action || "outline";
        const file = body?.file || "src/breaker.ts";
        const symbol = body?.symbol;
        const query = body?.query;

        let args: string[];
        if (action === "outline") args = ["outline", file];
        else if (action === "read") {
          if (!symbol) {
            return Response.json(
              { success: false, error: "Symbol é obrigatório para gira read" },
              { status: 400, headers: cors },
            );
          }
          args = ["read", file, symbol];
        } else if (action === "slice") args = ["slice", symbol || file, "--index", giraMapPath];
        else if (action === "impact") args = ["impact", symbol || file, "--index", giraMapPath];
        else if (action === "locate")
          args = ["locate", query || symbol || file, "--index", giraMapPath];
        else {
          return Response.json(
            { success: false, error: `Ação AST desconhecida: ${action}` },
            { status: 400, headers: cors },
          );
        }

        consecutiveReadsCount++;
        persistReads();
        notifySse("log", {
          source: "ast",
          level: "info",
          text: `📐 Consulta AST: gira ${args.join(" ")} (G1 reads: ${consecutiveReadsCount}/3)`,
          timestamp: new Date().toISOString(),
        });

        try {
          const proc = Bun.spawn(["gira", ...args], {
            cwd: cfg.root,
            stdout: "pipe",
            stderr: "pipe",
          });
          const stdoutText = await new Response(proc.stdout).text();
          const stderrText = await new Response(proc.stderr).text();
          const exitCode = await proc.exited;
          return Response.json(
            {
              success: exitCode === 0,
              exitCode,
              action,
              file,
              symbol,
              output: (stdoutText || stderrText).trim(),
            },
            { headers: cors },
          );
        } catch (err) {
          return Response.json(
            { success: false, error: `falha ao invocar gira: ${errText(err)}` },
            { status: 500, headers: cors },
          );
        }
      }

      // 11. Broadcast de log
      if (url.pathname === "/api/action/log" && req.method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch (err) {
          return Response.json(
            { ok: false, error: `corpo JSON inválido: ${errText(err)}` },
            { status: 400, headers: cors },
          );
        }
        notifySse("log", {
          source: body?.source || "user",
          level: body?.level || "info",
          text: body?.text || "",
          timestamp: new Date().toISOString(),
        });
        return Response.json({ ok: true }, { headers: cors });
      }

      // 11b. Processos ativos
      if (url.pathname === "/api/sessions" || url.pathname === "/api/agents") {
        try {
          const procs = scanProcesses();
          return Response.json({ total: procs.length, processes: procs }, { headers: cors });
        } catch (err) {
          return Response.json(
            { total: 0, processes: [], error: errText(err) },
            { status: 500, headers: cors },
          );
        }
      }

      // 11c. Controle de sessão: não implementado neste painel.
      if (url.pathname === "/api/action/session") {
        return Response.json(
          {
            success: false,
            error: "controle de sessão não implementado neste painel (stub removido)",
          },
          { status: 501, headers: cors },
        );
      }

      // 12. SPA
      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (!existsSync(cfg.htmlFile)) {
          return new Response(`index.html não encontrado em ${cfg.htmlFile}`, { status: 500 });
        }
        return new Response(readFileSync(cfg.htmlFile, "utf8"), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearInterval(timer);
    for (const client of sseClients) {
      try {
        client.close();
      } catch (err) {
        console.error(`[p-inga web] falha ao fechar cliente SSE: ${errText(err)}`);
      }
    }
    sseClients.clear();
    server.stop(true);
  };

  return { server, port: server.port ?? cfg.port, stop };
}

if (import.meta.main) {
  const cfg = readDashboardConfig();
  const panel = createDashboardServer(cfg);
  console.log(`[P-INGA DASHBOARD] G-Inga ativo em http://localhost:${panel.port}`);
  console.log(`[P-INGA DASHBOARD] root=${cfg.root} ledger=${cfg.ledgerPath}`);
}
