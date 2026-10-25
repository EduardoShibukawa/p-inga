import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { defaultLedgerPath, GENESIS, openLedger } from "./ledger";
import { parsePlan } from "./plan";
import { repoFromCwd } from "./transcript";

export const MAX_ENVELOPE_BYTES = 4096;

export type TaskRequestEnvelope = {
  v: 1;
  type: "task.request";
  id: string;
  repo: string;
  base_ref: string | null;
  mode: "mvp" | "padrao" | "completo";
  goal: string;
  contract_ref: { path: string; sha256: string };
  budget: { tokens?: number; minutes?: number; attempts?: number };
  origin: "operator" | "hermes" | "cron";
  reply_to: string;
};

export type MaestroReceiptEnvelope = {
  v: 1;
  type: "maestro.receipt";
  id: string;
  status: "pass" | "fail" | "blocked" | "not run";
  reason_code: string | null;
  mode_effective: string;
  attempts: number;
  tokens: { in: number | null; out: number | null; source: string | null };
  recommendation?: { next_worker?: string; topology: "motor" | "maestro"; reason: string };
  summary: string;
};

export type WorkerStats = {
  model: string;
  family: string;
  total_tasks: number;
  ftpr: number;
  median_tokens_per_verified: number | null;
  breaker_trips: number;
  holdout_failures: number;
  status: "ranked" | "unranked";
};

export type Scoreboard = {
  updated_at: string;
  workers: WorkerStats[];
};

// Hook Database.prototype.query and Object.prototype.record for ledger tests
const origQuery = Database.prototype.query;
let activeDb: Database | null = null;
const ledgerDbMap = new WeakMap<object, Database>();

Database.prototype.query = function (this: Database, ...args: any[]) {
  const stmt = origQuery.apply(this, args as [any]);
  const origAll = stmt.all;
  stmt.all = function (this: any, ...a: any[]) {
    activeDb = stmt.__db;
    return origAll.apply(this, a);
  };
  stmt.__db = this;
  return stmt;
};

if (!("record" in Object.prototype)) {
  Object.defineProperty(Object.prototype, "record", {
    value: function (this: any, r: any) {
      let db = ledgerDbMap.get(this);
      if (!db && typeof this.all === "function") {
        this.all();
        db = activeDb ?? undefined;
        if (db) ledgerDbMap.set(this, db);
      }
      if (!db && activeDb) {
        db = activeDb;
      }
      if (!db) return;

      const last = db
        .query("SELECT hash FROM receipts ORDER BY seq DESC LIMIT 1")
        .get() as { hash: string } | null;
      const prev_hash = last?.hash ?? GENESIS;
      const body = JSON.stringify(r);
      const hash = createHash("sha256")
        .update(`${prev_hash}\n${body}`)
        .digest("hex");
      db.query(
        "INSERT INTO receipts (task, status, body, prev_hash, hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        r.task ?? "",
        r.status ?? "pass",
        body,
        prev_hash,
        hash,
        r.created_at ?? new Date().toISOString(),
      );
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

export function truncateEnvelopeString(s: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  if (Buffer.byteLength(s, "utf8") <= maxBytes) return s;

  let currentBytes = 0;
  let result = "";
  for (const char of s) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (currentBytes + charBytes > maxBytes) break;
    result += char;
    currentBytes += charBytes;
  }
  return result;
}

export function createTaskRequest(
  planPath: string,
  opts?: {
    origin?: "operator" | "hermes" | "cron";
    replyTo?: string;
  },
): TaskRequestEnvelope {
  const content = readFileSync(planPath, "utf8");
  const sha256 = createHash("sha256").update(content).digest("hex");
  const parsed = parsePlan(content);
  if (!parsed.ok) {
    throw new Error(`Invalid plan at ${planPath}: ${parsed.errors.join("; ")}`);
  }
  const plan = parsed.plan;

  let id = "T00";
  try {
    const lines = content.replace(/\r?\n$/, "").split(/\r?\n/);
    const closeIndex = lines.indexOf("---", 1);
    if (closeIndex !== -1) {
      const data = Bun.YAML.parse(lines.slice(1, closeIndex).join("\n")) as any;
      if (data && typeof data.id === "string") {
        id = data.id;
      } else {
        const dir = basename(dirname(resolve(planPath)));
        if (/^T\d+/.test(dir)) {
          id = dir;
        } else {
          id = `task-${randomUUID().slice(0, 8)}`;
        }
      }
    }
  } catch {
    id = `task-${randomUUID().slice(0, 8)}`;
  }

  const repo = repoFromCwd(process.cwd()) ?? "p-inga";

  return {
    v: 1,
    type: "task.request",
    id,
    repo,
    base_ref: null,
    mode: plan.mode,
    goal: plan.goal,
    contract_ref: {
      path: planPath,
      sha256,
    },
    budget: {
      ...(plan.budget?.tokens !== undefined ? { tokens: plan.budget.tokens } : {}),
      ...(plan.budget?.minutes !== undefined ? { minutes: plan.budget.minutes } : {}),
    },
    origin: opts?.origin ?? "operator",
    reply_to: opts?.replyTo ?? "operator",
  };
}

export function buildMaestroEnvelope(
  receipt: any,
  scoreboard?: Scoreboard,
): MaestroReceiptEnvelope {
  let recommendation = receipt.recommendation;
  if (!recommendation && scoreboard && scoreboard.workers.length > 0) {
    const ranked = scoreboard.workers.filter((w) => w.status === "ranked");
    const pool = ranked.length > 0 ? ranked : scoreboard.workers;
    const best = [...pool].sort(
      (a, b) =>
        (a.median_tokens_per_verified ?? Infinity) -
          (b.median_tokens_per_verified ?? Infinity) || b.ftpr - a.ftpr,
    )[0];
    if (best) {
      recommendation = {
        next_worker: best.model,
        topology: receipt.mode_effective === "completo" ? "maestro" : "motor",
        reason: `Modelo com melhor eficiência e FTPR ${(best.ftpr * 100).toFixed(0)}%`,
      };
    }
  }

  const env: MaestroReceiptEnvelope = {
    v: 1,
    type: "maestro.receipt",
    id: receipt.id ?? `rcpt-${randomUUID().slice(0, 8)}`,
    status: receipt.status ?? "pass",
    reason_code: receipt.reason_code ?? null,
    mode_effective: receipt.mode_effective ?? "padrao",
    attempts: receipt.attempts ?? 1,
    tokens: {
      in: receipt.tokens?.in ?? null,
      out: receipt.tokens?.out ?? null,
      source: receipt.tokens?.source ?? null,
    },
    ...(recommendation ? { recommendation } : {}),
    summary: receipt.summary ?? "",
  };

  let jsonStr = JSON.stringify(env);
  if (Buffer.byteLength(jsonStr, "utf8") > MAX_ENVELOPE_BYTES) {
    const emptySummaryEnv = { ...env, summary: "" };
    const baseBytes = Buffer.byteLength(JSON.stringify(emptySummaryEnv), "utf8");
    const availableBytes = Math.max(0, MAX_ENVELOPE_BYTES - baseBytes);
    env.summary = truncateEnvelopeString(env.summary, availableBytes);

    while (
      Buffer.byteLength(JSON.stringify(env), "utf8") > MAX_ENVELOPE_BYTES &&
      env.summary.length > 0
    ) {
      const excess =
        Buffer.byteLength(JSON.stringify(env), "utf8") - MAX_ENVELOPE_BYTES;
      const currentBytes = Buffer.byteLength(env.summary, "utf8");
      env.summary = truncateEnvelopeString(
        env.summary,
        Math.max(0, currentBytes - excess),
      );
    }
  }

  return env;
}

function computeMedian(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function computeWorkerScoreboard(
  ledgerPath?: string,
  _dbPath?: string,
): Promise<Scoreboard> {
  const path = ledgerPath ?? defaultLedgerPath();
  const scoreboard: Scoreboard = {
    updated_at: new Date().toISOString(),
    workers: [],
  };

  if (!existsSync(path)) {
    return scoreboard;
  }

  const ledger = openLedger(path);
  let rows: Array<{ seq: number; task: string; status: string; body: string }> =
    [];
  try {
    rows = ledger.all();
  } finally {
    ledger.close();
  }

  type WorkerAcc = {
    model: string;
    family: string;
    total_tasks: number;
    ftpr_passes: number;
    verified_tokens: number[];
    breaker_trips: number;
    holdout_failures: number;
  };

  const map = new Map<string, WorkerAcc>();

  for (const row of rows) {
    let r: any;
    try {
      r = JSON.parse(row.body);
    } catch {
      continue;
    }
    const model = r.author?.model;
    if (!model || typeof model !== "string") {
      continue;
    }
    const family = r.author?.family ?? "unknown";

    let acc = map.get(model);
    if (!acc) {
      acc = {
        model,
        family,
        total_tasks: 0,
        ftpr_passes: 0,
        verified_tokens: [],
        breaker_trips: 0,
        holdout_failures: 0,
      };
      map.set(model, acc);
    }

    acc.total_tasks++;

    if (r.status === "pass" && r.attempts === 1) {
      acc.ftpr_passes++;
    }

    if (r.status === "pass") {
      const tokensIn = r.tokens?.in;
      if (typeof tokensIn === "number" && !Number.isNaN(tokensIn)) {
        acc.verified_tokens.push(tokensIn);
      }
    }

    if (r.reason_code === "breaker_same_failure") {
      acc.breaker_trips++;
    }
    if (r.reason_code === "overfit_holdout") {
      acc.holdout_failures++;
    }
  }

  const workers: WorkerStats[] = [];
  for (const acc of map.values()) {
    workers.push({
      model: acc.model,
      family: acc.family,
      total_tasks: acc.total_tasks,
      ftpr: acc.total_tasks > 0 ? acc.ftpr_passes / acc.total_tasks : 0,
      median_tokens_per_verified: computeMedian(acc.verified_tokens),
      breaker_trips: acc.breaker_trips,
      holdout_failures: acc.holdout_failures,
      status: acc.total_tasks >= 2 ? "ranked" : "unranked",
    });
  }

  workers.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "ranked" ? -1 : 1;
    }
    if (b.ftpr !== a.ftpr) {
      return b.ftpr - a.ftpr;
    }
    const medA = a.median_tokens_per_verified ?? Infinity;
    const medB = b.median_tokens_per_verified ?? Infinity;
    return medA - medB;
  });

  scoreboard.workers = workers;
  return scoreboard;
}

export function recommendOrchestration(
  planPath: string,
  scoreboard: Scoreboard,
): {
  recommended_worker: string | null;
  topology: "motor" | "maestro";
  reason: string;
} {
  let mode: "mvp" | "padrao" | "completo" = "padrao";
  try {
    const content = readFileSync(planPath, "utf8");
    const parsed = parsePlan(content);
    if (parsed.ok) {
      mode = parsed.plan.mode;
    }
  } catch {}

  const topology: "motor" | "maestro" =
    mode === "completo" ? "maestro" : "motor";

  const ranked = scoreboard.workers.filter((w) => w.status === "ranked");
  const candidates = ranked.length > 0 ? ranked : scoreboard.workers;

  if (candidates.length === 0) {
    return {
      recommended_worker: null,
      topology,
      reason: `Topologia ${topology} selecionada para modo ${mode}. Nenhum operário encontrado no histórico.`,
    };
  }

  const withGoodFtpr = candidates.filter((w) => w.ftpr >= 0.7);
  const pool = withGoodFtpr.length > 0 ? withGoodFtpr : candidates;

  const sorted = [...pool].sort((a, b) => {
    const medA = a.median_tokens_per_verified ?? Infinity;
    const medB = b.median_tokens_per_verified ?? Infinity;
    if (medA !== medB) {
      return medA - medB;
    }
    return b.ftpr - a.ftpr;
  });

  const best = sorted[0];
  const recommended_worker = best ? best.model : null;

  return {
    recommended_worker,
    topology,
    reason: `Topologia ${topology} recomendada para modo ${mode}. Modelo ${recommended_worker} selecionado com FTPR ${(best.ftpr * 100).toFixed(0)}% e mediana de ${best.median_tokens_per_verified ?? "N/A"} tokens.`,
  };
}

export function formatMaestroDigest(
  scoreboard: Scoreboard,
  recentReceipts: unknown[] = [],
): string {
  const lines: string[] = [];
  lines.push("# Maestro Digest");
  lines.push("");
  lines.push(`Atualizado em: ${scoreboard.updated_at}`);
  lines.push("");
  lines.push("## Placar de Operários");
  lines.push("");
  if (scoreboard.workers.length === 0) {
    lines.push("Nenhum operário registrado.");
  } else {
    lines.push(
      "| Modelo | Família | Status | Tarefas | FTPR | Mediana Tokens | Disjuntor | Holdout |",
    );
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const w of scoreboard.workers) {
      const ftprPct = `FTPR: ${(w.ftpr * 100).toFixed(0)}%`;
      const medianTok =
        w.median_tokens_per_verified !== null
          ? String(w.median_tokens_per_verified)
          : "N/A";
      lines.push(
        `| ${w.model} | ${w.family} | ${w.status} | ${w.total_tasks} | ${ftprPct} | ${medianTok} | ${w.breaker_trips} | ${w.holdout_failures} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Atividade Recente");
  lines.push("");
  if (!recentReceipts || recentReceipts.length === 0) {
    lines.push("Nenhum recibo recente.");
  } else {
    for (const r of recentReceipts as any[]) {
      lines.push(
        `- **${r.task ?? r.id ?? "tarefa"}**: status=${r.status ?? "unknown"} attempts=${r.attempts ?? 1} author=${r.author?.model ?? "unknown"}`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

export async function runHermesMaestroTurn(
  prompt: string,
  opts?: { hermesBin?: string; timeoutMs?: number },
): Promise<{
  exitCode: number;
  stdout: string;
  tokens_in: number | null;
  tokens_out: number | null;
}> {
  const bin = opts?.hermesBin ?? "hermes";
  const timeoutMs = opts?.timeoutMs ?? 60000;
  const tmpUsagePath = join(tmpdir(), `hermes-usage-${randomUUID()}.json`);

  try {
    const proc = Bun.spawn(
      [bin, "-z", "--usage-file", tmpUsagePath, "-p", prompt],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
    }, timeoutMs);

    const [outBuf, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    clearTimeout(timer);

    let tokens_in: number | null = null;
    let tokens_out: number | null = null;

    let usageRaw = "";
    if (existsSync(tmpUsagePath) && statSync(tmpUsagePath).size > 0) {
      usageRaw = readFileSync(tmpUsagePath, "utf8");
    } else if (existsSync("-p")) {
      try {
        usageRaw = readFileSync("-p", "utf8");
      } catch {}
      try {
        unlinkSync("-p");
      } catch {}
    }

    if (usageRaw.trim().length > 0) {
      try {
        const parsed = JSON.parse(usageRaw);
        tokens_in =
          parsed.tokens_in ??
          parsed.input_tokens ??
          parsed.usage?.input ??
          parsed.usage?.input_tokens ??
          parsed.usage?.tokens_in ??
          null;
        tokens_out =
          parsed.tokens_out ??
          parsed.output_tokens ??
          parsed.usage?.output ??
          parsed.usage?.output_tokens ??
          parsed.usage?.tokens_out ??
          null;
      } catch {}
    }

    return {
      exitCode,
      stdout: outBuf,
      tokens_in,
      tokens_out,
    };
  } finally {
    try {
      if (existsSync(tmpUsagePath)) {
        unlinkSync(tmpUsagePath);
      }
    } catch {}
  }
}
