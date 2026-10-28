import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { repoScope, scopedReceipts } from "./breaker";
import { notifyReceipt } from "./discord";
import { defaultLedgerPath, openLedger } from "./ledger";
import type { Ledger } from "./ledger";
import type { ReasonCode, Receipt, Status } from "./receipt";
import { receiptKind } from "./receipt";
import { resolveRepoRoot } from "./prove";
import { taskRef } from "./task_ref";
import { resolveUsageFile, tokenFieldsFor } from "./tokens";

/** Pasta do PLAN: `PLAN-0005`, `PLAN-0005-pinga-task-e-plan`. */
const PLAN_DIR_RE = /^(PLAN-\d+)(?:-|$)/;
/** Arquivo de TASK no bundle: `TASK-01-a.md`, `TASK-02-hipotese-lock.md`. */
const TASK_FILE_RE = /^TASK-.*\.md$/i;

/** PLAN inválido (sem done_when, frontmatter quebrado) sai como 3, como o plano de task. */
const PLAN_INVALID_EXIT = 3;
/** TASKs ainda sem `pass`: bloqueio processual, ainda não é falha do contrato. */
const TASKS_OPEN_EXIT = 2;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

export type PlanVerifyOptions = {
  root?: string;
  usageFile?: string;
};

type Frontmatter =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: string[] };

function readFrontmatter(text: string): Frontmatter {
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  if (lines[0] !== "---") {
    return { ok: false, errors: ["frontmatter deve começar com '---'"] };
  }
  const closeIndex = lines.indexOf("---", 1);
  if (closeIndex === -1) {
    return { ok: false, errors: ["frontmatter não fechado por '---'"] };
  }
  let data: unknown;
  try {
    data = Bun.YAML.parse(lines.slice(1, closeIndex).join("\n"));
  } catch (err) {
    return { ok: false, errors: [`YAML inválido: ${(err as Error).message}`] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, errors: ["frontmatter deve ser um mapping"] };
  }
  return { ok: true, data: data as Record<string, unknown> };
}

/** `true` quando o documento é um PLAN (`type: plan`), não uma TASK. */
export function isPlanDoc(planPath: string): boolean {
  try {
    const fm = readFrontmatter(readFileSync(resolve(planPath), "utf8"));
    return fm.ok && fm.data.type === "plan";
  } catch {
    return false;
  }
}

function planRefOf(dir: string): string {
  return PLAN_DIR_RE.exec(basename(dir))?.[1] ?? basename(dir);
}

/**
 * Refs das TASKs do bundle. O PLAN não tem limite de 25 linhas nem `mode`:
 * só `done_when` é exigido, porque é ele que sela a integração.
 */
function validatePlanDoc(
  fm: Frontmatter,
): { ok: true; done_when: string } | { ok: false; errors: string[] } {
  if (!fm.ok) return fm;
  const d = fm.data;
  const errors: string[] = [];
  if (d.type !== "plan") errors.push("type: plan ausente");
  if (d.done_when === undefined) {
    errors.push("missing field: done_when");
  } else if (
    typeof d.done_when !== "string" ||
    d.done_when.trim().length === 0
  ) {
    errors.push("invalid field: done_when must be a non-empty string");
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, done_when: d.done_when as string };
}

type TaskFile = { name: string; ref: string };

function taskFiles(dir: string, planRef: string): TaskFile[] {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && TASK_FILE_RE.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
  return names.map((name) => {
    const ref = taskRef(join(dir, name));
    return { name, ref: ref.includes("/") ? ref : `${planRef}/${name.replace(/\.md$/i, "")}` };
  });
}

function hasPassReceipt(ledger: Ledger, ref: string, repo?: string): boolean {
  return scopedReceipts(ledger, ref, repo).some(
    (r) => r.status === "pass" && receiptKind(r) === "verify",
  );
}

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

type Common = {
  task: string;
  repo?: string;
  attempt: number;
  usageFile?: string;
};

function seal(
  ledger: Ledger,
  common: Common,
  status: Status,
  reason_code: ReasonCode | null,
  evidence: Receipt["evidence"],
  summary: string,
): Receipt {
  const tf = tokenFieldsFor(resolveUsageFile(common.usageFile));
  const receipt: Receipt = {
    v: 1,
    type: "task.receipt",
    id: randomUUID(),
    task: common.task,
    ...(common.repo !== undefined ? { repo: common.repo } : {}),
    status,
    reason_code,
    attempts: common.attempt,
    evidence,
    tokens: tf.tokens,
    cost_usd: tf.cost_usd,
    cost_evidence: tf.cost_evidence,
    author: {
      model: process.env.PINGA_AUTHOR_MODEL ?? null,
      family: process.env.PINGA_AUTHOR_FAMILY ?? null,
    },
    verified_by: null,
    check: "plan",
    summary: summary.slice(0, 280),
    created_at: new Date().toISOString(),
  };
  ledger.append(receipt);
  if (process.env.PINGA_DISCORD_NOTIFY === "1") {
    notifyReceipt(receipt).catch(() => {});
  }
  console.log(JSON.stringify(receipt));
  return receipt;
}

/**
 * `pinga verify <PLAN.md>` para documento `type: plan`: todas as TASK-*.md da
 * pasta precisam de receipt `pass` (ref PLAN-NNNN/TASK-NN) e só então o
 * `done_when` do PLAN roda e sela `task: PLAN-NNNN`, `check: plan`.
 * `kind: investigation` percorre o mesmo caminho (as hipóteses são TASKs).
 */
export function verifyPlanDoc(
  planPath: string,
  ledgerPathArg?: string,
  attemptArg?: number,
  opts: PlanVerifyOptions = {},
): number {
  const resolved = resolve(planPath);
  if (!existsSync(resolved)) {
    console.error(`Erro: arquivo de plano não encontrado em ${resolved}`);
    return PLAN_INVALID_EXIT;
  }

  const rootRes = resolveRepoRoot(resolved, opts.root);
  if (!rootRes.ok) {
    console.error(rootRes.error);
    return 2;
  }
  const repoRoot = rootRes.root;

  const dir = dirname(resolved);
  const planRef = planRefOf(dir);

  const ledger = openLedger(ledgerPathArg ?? defaultLedgerPath());
  const repo = repoScope(repoRoot);
  try {
    const attempt =
      attemptArg ?? 1 + scopedReceipts(ledger, planRef, repo).length;
    const common: Common = {
      task: planRef,
      ...(repo !== undefined ? { repo } : {}),
      attempt,
      usageFile: opts.usageFile,
    };

    const doc = validatePlanDoc(readFrontmatter(readFileSync(resolved, "utf8")));
    if (!doc.ok) {
      seal(
        ledger,
        common,
        "blocked",
        "plan_invalid",
        [],
        `${planRef} blocked: plano inválido (${doc.errors[0]})`,
      );
      return PLAN_INVALID_EXIT;
    }

    const tasks = taskFiles(dir, planRef);
    if (tasks.length === 0) {
      seal(
        ledger,
        common,
        "blocked",
        "tasks_open",
        [],
        `${planRef} blocked: nenhuma TASK-*.md em ${basename(dir)}; nada a integrar`,
      );
      return TASKS_OPEN_EXIT;
    }

    const open = tasks.filter((t) => !hasPassReceipt(ledger, t.ref, repo));
    if (open.length > 0) {
      seal(
        ledger,
        common,
        "blocked",
        "tasks_open",
        [],
        `${planRef} blocked: TASKs sem receipt pass: ${open
          .map((t) => t.ref)
          .join(", ")}`,
      );
      return TASKS_OPEN_EXIT;
    }

    const timeoutMs = process.env.PINGA_TIMEOUT_MS
      ? Number(process.env.PINGA_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

    const t0 = Date.now();
    const res = Bun.spawnSync(["sh", "-c", doc.done_when], {
      cwd: repoRoot,
      timeout: timeoutMs,
      stdout: "pipe",
      stderr: "pipe",
    });
    const duration_ms = Math.max(0, Date.now() - t0);

    const outBuffer = Buffer.concat([
      res.stdout as Uint8Array,
      res.stderr as Uint8Array,
    ]);
    const attemptDir = join(repoRoot, "runs", planRef, String(attempt));
    mkdirSync(attemptDir, { recursive: true });
    writeFileSync(join(attemptDir, "out.txt"), outBuffer);

    const evidence: Receipt["evidence"] = [
      {
        kind: "command",
        cmd_sha256: sha256hex(doc.done_when),
        exit: res.exitCode,
        duration_ms,
        artifact_ref: {
          path: `runs/${planRef}/${attempt}/out.txt`,
          sha256: sha256hex(outBuffer),
        },
      },
    ];
    const segundos = Math.round(duration_ms / 1000);

    if (res.exitedDueToTimeout || res.exitCode === null) {
      seal(
        ledger,
        common,
        "blocked",
        "budget",
        evidence,
        `${planRef} blocked: done_when do PLAN estourou o tempo em ${segundos}s (${tasks.length} TASKs pass)`,
      );
      return 2;
    }

    if (res.exitCode !== 0) {
      seal(
        ledger,
        common,
        "fail",
        "command_failed",
        evidence,
        `${planRef} fail: done_when exit ${res.exitCode} em ${segundos}s (${tasks.length} TASKs pass)`,
      );
      return 1;
    }

    seal(
      ledger,
      common,
      "pass",
      null,
      evidence,
      `${planRef} pass: done_when exit 0 em ${segundos}s (${tasks.length} TASKs pass)`,
    );
    return 0;
  } finally {
    ledger.close();
  }
}
