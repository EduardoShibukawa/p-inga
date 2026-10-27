import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { defaultLedgerPath, openLedger } from "./ledger";
import { changedFiles, fileDigest } from "./guards";
import type { DriftBaseline } from "./guards";
import { parsePlan } from "./plan";

export const QUEUE_VERSION = 1;
export const DEFAULT_LEASE_TTL_S = 1800;

/**
 * Estados da fila. `done` exige receipt `pass` no ledger (zero auto-atestação):
 * `done_when` exit 0 sem receipt é `awaiting_receipt`, nunca `done`.
 */
export type QueueState =
  | "done"
  | "awaiting_receipt"
  | "blocked"
  | "leased"
  | "open"
  | "invalid_plan"
  | "superseded";

export type QueueLease = {
  pid: number;
  started_at: string;
  ttl_s: number;
  alive: boolean;
};

export type QueueEntry = {
  task: string;
  plan_path: string;
  state: QueueState;
  goal: string | null;
  reason_code: string | null;
  receipt: { seq: number; status: string } | null;
  plan_errors: string[];
  lease: QueueLease | null;
  done_when_exit: number | null;
};

export type QueueReport = {
  v: number;
  root: string;
  ledger: string | null;
  counts: Record<QueueState, number>;
  tasks: QueueEntry[];
};

type LedgerRowLite = { seq: number; task: string; status: string; body: string };

const EMPTY_COUNTS = (): Record<QueueState, number> => ({
  done: 0,
  superseded: 0,
  awaiting_receipt: 0,
  blocked: 0,
  leased: 0,
  open: 0,
  invalid_plan: 0,
});

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = existe mas é de outro usuário; conta como vivo.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sortKey(task: string): [number, number, string] {
  const m = /^T?0*(\d+)$/i.exec(task);
  if (m !== null) return [0, Number(m[1]), task];
  return [1, 0, task];
}

export function sortTasks<T extends { task: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const ka = sortKey(a.task);
    const kb = sortKey(b.task);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2].localeCompare(kb[2]);
  });
}

function normalizeTask(name: string): string {
  const trimmed = name.trim();
  const m = /^T?0*(\d+)$/i.exec(trimmed);
  return m !== null ? `T${Number(m[1])}` : trimmed.toLowerCase();
}

function latestReceipt(
  rows: LedgerRowLite[],
  task: string,
): { seq: number; status: string; reason_code: string | null } | null {
  const wanted = normalizeTask(task);
  let best: { seq: number; status: string; reason_code: string | null } | null = null;
  for (const row of rows) {
    if (normalizeTask(row.task) !== wanted) continue;
    if (best !== null && row.seq <= best.seq) continue;
    let reason: string | null = null;
    try {
      const parsed = JSON.parse(row.body) as { reason_code?: unknown };
      if (typeof parsed.reason_code === "string") reason = parsed.reason_code;
    } catch {
      reason = null;
    }
    best = { seq: row.seq, status: row.status, reason_code: reason };
  }
  return best;
}

/**
 * Recibos processuais: não são verificação do contrato. Juiz sem atestação de
 * família de modelo, harness indisponível e guarda de delta acontecem *depois*
 * do `done_when` já ter passado, então não revogam um `pass` obtido. O próprio
 * `delta_no_touch` afirma que "o contrato já passa no base".
 */
const PROCEDURAL_REASON_CODES = new Set(["delta_no_touch", "model_unattested", "infra"]);

function hasPassReceipt(rows: LedgerRowLite[], task: string): boolean {
  const wanted = normalizeTask(task);
  return rows.some(
    (row) => normalizeTask(row.task) === wanted && row.status === "pass",
  );
}

function readLease(root: string, task: string): QueueLease | null {
  const path = join(root, "tasks", task, ".lease");
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<QueueLease>;
    if (typeof raw.pid !== "number" || typeof raw.started_at !== "string") return null;
    const ttl_s = typeof raw.ttl_s === "number" ? raw.ttl_s : DEFAULT_LEASE_TTL_S;
    const startedMs = Date.parse(raw.started_at);
    const expired = Number.isFinite(startedMs)
      ? Date.now() - startedMs > ttl_s * 1000
      : false;
    return { pid: raw.pid, started_at: raw.started_at, ttl_s, alive: pidAlive(raw.pid) && !expired };
  } catch {
    return null;
  }
}

function probeDoneWhen(root: string, cmd: string, timeoutMs: number): number | null {
  try {
    const proc = Bun.spawnSync(["sh", "-c", cmd], {
      cwd: root,
      stdout: "ignore",
      stderr: "ignore",
      timeout: timeoutMs,
    });
    return proc.exitCode;
  } catch {
    return null;
  }
}

export function scanQueue(
  opts: {
    root?: string;
    ledgerPath?: string;
    probe?: boolean;
    /** Restringe o probe a uma task. `undefined` + `probe: true` = probe de todas. */
    probeTask?: string;
    probeTimeoutMs?: number;
    rows?: LedgerRowLite[];
  } = {},
): QueueReport {
  const root = opts.root ?? process.cwd();
  const probeTimeoutMs = opts.probeTimeoutMs ?? 10_000;
  const tasksDir = join(root, "tasks");

  let ledgerPath: string | null = null;
  let rows: LedgerRowLite[] = opts.rows ?? [];

  if (opts.rows === undefined) {
    const candidate = opts.ledgerPath ?? defaultLedgerPath();
    if (existsSync(candidate)) {
      const led = openLedger(candidate);
      try {
        rows = led.all();
      } finally {
        led.close();
      }
      ledgerPath = candidate;
    }
  } else if (opts.ledgerPath !== undefined) {
    ledgerPath = opts.ledgerPath;
  }

  const report: QueueReport = {
    v: QUEUE_VERSION,
    root,
    ledger: ledgerPath,
    counts: EMPTY_COUNTS(),
    tasks: [],
  };

  if (!existsSync(tasksDir)) return report;

  const dirs = readdirSync(tasksDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const task of sortTasks(dirs.map((task) => ({ task }))).map((d) => d.task)) {
    const planPath = join(tasksDir, task, "PLAN.md");
    if (!existsSync(planPath)) continue;

    const parsed = parsePlan(readFileSync(planPath, "utf8"));
    const receipt = latestReceipt(rows, task);
    const lease = readLease(root, task);
    const planErrors = parsed.ok ? [] : parsed.errors;

    let state: QueueState;
    let doneWhenExit: number | null = null;

    if (!parsed.ok) {
      state = "invalid_plan";
    } else {
      const shouldProbe =
        opts.probe === true &&
        (opts.probeTask === undefined || normalizeTask(opts.probeTask) === normalizeTask(task));
      if (shouldProbe) {
        doneWhenExit = probeDoneWhen(root, parsed.plan.done_when, probeTimeoutMs);
      }
      if (doneWhenExit === 0) {
        state = receipt?.status === "pass" ? "done" : "awaiting_receipt";
      } else if (receipt?.status === "pass") {
        state = "done";
      } else if (
        receipt?.status === "blocked" &&
        receipt.reason_code === "superseded"
      ) {
        // Fechada pelo operador: contrato já satisfeito no base, sem trabalho
        // nesta fatia. Nunca vira `pass`; sai da fila e não é reexecutada.
        state = "superseded";
      } else if (
        receipt?.status === "blocked" &&
        PROCEDURAL_REASON_CODES.has(receipt.reason_code ?? "") &&
        hasPassReceipt(rows, task)
      ) {
        // O contrato já foi provado por um `pass` anterior; o recibo posterior é
        // ruído processual (juiz sem atestação, infra, guarda de delta).
        state = "done";
      } else if (receipt?.status === "blocked") {
        state = "blocked";
      } else if (lease?.alive === true) {
        state = "leased";
      } else {
        // fail/not run/ausente => retomável
        state = "open";
      }
    }

    report.counts[state] += 1;
    report.tasks.push({
      task,
      plan_path: `tasks/${task}/PLAN.md`,
      state,
      goal: parsed.ok ? parsed.plan.goal : null,
      reason_code: receipt?.reason_code ?? null,
      receipt: receipt === null ? null : { seq: receipt.seq, status: receipt.status },
      plan_errors: planErrors,
      lease,
      done_when_exit: doneWhenExit,
    });
  }

  return report;
}

/** Próxima task executável: menor número em `open`; depois `awaiting_receipt`. */
export function nextTask(entries: QueueEntry[]): QueueEntry | null {
  const ordered = sortTasks(entries);
  return (
    ordered.find((e) => e.state === "open") ??
    ordered.find((e) => e.state === "awaiting_receipt") ??
    null
  );
}

/**
 * Só abre lease o que ainda tem trabalho. `--claim TASK` forçado existe para
 * iterar em bloqueio/retomada; abrir lease em `done`/`superseded` reexecutaria
 * um contrato já selado (e o `verify` seguinte só produziria recibo processual).
 */
export function canClaim(state: QueueState): boolean {
  return state === "open" || state === "awaiting_receipt" || state === "blocked";
}

export function baselinePath(root: string, task: string): string {
  return join(root, "tasks", task, ".baseline.json");
}

export type ClaimBaseline = {
  v: 1;
  head: string | null;
  dirty: DriftBaseline;
};

function headSha(root: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

/**
 * Fundamento do claim: HEAD do momento + o que já estava sujo (sha256 por path).
 * O `verify` passa a medir drift a partir daqui, então commits já feitos e
 * trabalho não commitado de tasks anteriores deixam de ser "fora do touch" —
 * sem exigir commit novo, que é proibido nesta fatia.
 */
function captureBaseline(root: string): ClaimBaseline {
  const dirty: DriftBaseline = {};
  for (const rel of changedFiles(root, "HEAD")) {
    if (rel.endsWith("/.lease") || rel.endsWith("/.baseline.json")) continue;
    dirty[rel] = fileDigest(root, rel);
  }
  return { v: 1, head: headSha(root), dirty };
}

export function claim(
  root: string,
  task: string,
  ttl_s: number = DEFAULT_LEASE_TTL_S,
): { ok: boolean; reason?: string; lease_path?: string } {
  const planPath = join(root, "tasks", task, "PLAN.md");
  if (!existsSync(planPath)) return { ok: false, reason: `sem PLAN.md para ${task}` };

  const existing = readLease(root, task);
  if (existing?.alive === true) {
    return {
      ok: false,
      reason: `task ${task} já tem lease vivo (pid ${existing.pid}, desde ${existing.started_at})`,
    };
  }

  const leasePath = join(root, "tasks", task, ".lease");
  writeFileSync(
    leasePath,
    `${JSON.stringify(
      { pid: process.pid, started_at: new Date().toISOString(), ttl_s },
      null,
      2,
    )}\n`,
  );

  const baseline = captureBaseline(root);
  writeFileSync(
    baselinePath(root, task),
    `${JSON.stringify(baseline, null, 2)}\n`,
  );

  return { ok: true, lease_path: leasePath };
}

export function release(root: string, task: string): { ok: boolean } {
  const leasePath = join(root, "tasks", task, ".lease");
  if (!existsSync(leasePath)) return { ok: false };
  rmSync(leasePath, { force: true });
  return { ok: true };
}

export type QueueSnapshot = Record<string, QueueState>;

export function snapshotPath(root: string): string {
  return join(root, ".pinga", "queue-snapshot.json");
}

export function readSnapshot(root: string): QueueSnapshot {
  const path = snapshotPath(root);
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object") return {};
    const out: QueueSnapshot = {};
    for (const [task, state] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof state === "string") out[task] = state as QueueState;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSnapshot(root: string, report: QueueReport): void {
  const path = snapshotPath(root);
  const dir = join(root, ".pinga");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const snap: QueueSnapshot = {};
  for (const entry of report.tasks) snap[entry.task] = entry.state;
  writeFileSync(path, `${JSON.stringify(snap, null, 2)}\n`);
}

export type QueueTransition = {
  task: string;
  from: QueueState | null;
  to: QueueState;
};

/** Só transições que merecem aviso humano: entrar em blocked, invalid_plan ou done. */
export const NOTIFY_STATES: QueueState[] = [
  "blocked",
  "invalid_plan",
  "done",
  "superseded",
];

export function transitions(
  previous: QueueSnapshot,
  report: QueueReport,
): QueueTransition[] {
  const out: QueueTransition[] = [];
  for (const entry of report.tasks) {
    const from = previous[entry.task] ?? null;
    if (from === entry.state) continue;
    out.push({ task: entry.task, from, to: entry.state });
  }
  return out;
}

export function formatQueueDigest(
  report: QueueReport,
  changes: QueueTransition[],
): string {
  const c = report.counts;
  const head = `queue: open ${c.open} · awaiting_receipt ${c.awaiting_receipt} · blocked ${c.blocked} · leased ${c.leased} · done ${c.done} · superseded ${c.superseded} · invalid_plan ${c.invalid_plan}`;
  const lines = report.tasks.map((e) => {
    const rc = e.reason_code === null ? "" : ` reason=${e.reason_code}`;
    const errs = e.plan_errors.length === 0 ? "" : ` erros=${e.plan_errors.length}`;
    return `  ${e.state.padEnd(16)} ${e.task}${rc}${errs}`;
  });
  const notify = changes
    .filter((t) => NOTIFY_STATES.includes(t.to))
    .map((t) => `  ${t.task}: ${t.from ?? "novo"} -> ${t.to}`);
  const tail =
    notify.length === 0 ? "  (sem transições para avisar)" : `transições:\n${notify.join("\n")}`;
  return `${head}\n${lines.join("\n")}\n${tail}`;
}

