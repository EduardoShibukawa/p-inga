import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defaultLedgerPath, openLedger } from "./ledger";
import { parsePlan } from "./plan";
import type { Receipt } from "./receipt";
import { NOT_RUN_TOKENS } from "./tokens";

const sha256hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

/**
 * Última linha não vazia da saída de um comando, truncada — o suficiente para o
 * operador saber por que o `done_when` falhou sem abrir `runs/<T>/supersede/out.txt`.
 */
export function lastMeaningfulLine(
  buf: Uint8Array | string,
  max = 200,
): string {
  const text = typeof buf === "string" ? buf : Buffer.from(buf).toString("utf8");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.length > 0 ? lines[lines.length - 1] : "";
  return last.length > max ? `${last.slice(0, max)}…` : last;
}

export interface SupersedeOptions {
  reason: string;
  ledgerPath: string | undefined;
  timeoutMs?: number;
};

export const SUPERSEDE_EXIT = {
  ok: 0,
  usage: 2,
  plan_invalid: 3,
  command_failed: 4,
  already_done: 5,
} as const;

/**
 * Fecha uma task cujo contrato (`done_when`) já está satisfeito no base, sem
 * trabalho atribuível a esta fatia. Não é atalho para `pass`: sela recibo
 * `blocked` com reason `superseded`, provando com a execução real do `done_when`
 * e guardando o artefato. A fila passa a mostrar `superseded` e não a reexecuta.
 */
export function supersedeTask(
  planPath: string,
  opts: SupersedeOptions,
): number {
  const reason = (opts.reason ?? "").trim();
  if (reason.length === 0) {
    console.error("supersede: --reason é obrigatório (por que não há trabalho)");
    return SUPERSEDE_EXIT.usage;
  }

  const resolvedPlanPath = resolve(planPath);
  if (!existsSync(resolvedPlanPath)) {
    console.error(`Erro: arquivo de plano não encontrado em ${resolvedPlanPath}`);
    return SUPERSEDE_EXIT.plan_invalid;
  }
  const task = basename(dirname(resolvedPlanPath));

  const parsed = parsePlan(readFileSync(resolvedPlanPath, "utf8"));
  if (!parsed.ok) {
    console.error(`supersede: plano inválido (${parsed.errors[0]})`);
    return SUPERSEDE_EXIT.plan_invalid;
  }
  const plan = parsed.plan;

  const gitRoot = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd: dirname(resolvedPlanPath),
    stdout: "pipe",
    stderr: "pipe",
  });
  const repoRoot =
    gitRoot.exitCode === 0
      ? gitRoot.stdout.toString().trim()
      : dirname(resolvedPlanPath);

  const ledger = openLedger(opts.ledgerPath ?? defaultLedgerPath());
  const rows = ledger
    .all()
    .filter((row) => row.task === task)
    .map((row) => {
      try {
        return JSON.parse(row.body) as { status?: string; reason_code?: string };
      } catch {
        return {};
      }
    });

  if (rows.some((r) => r.status === "pass")) {
    console.error(
      `supersede: ${task} já tem recibo pass; superseded é só para contrato sem trabalho`,
    );
    return SUPERSEDE_EXIT.already_done;
  }

  const t0 = Date.now();
  const res = Bun.spawnSync(["sh", "-c", plan.done_when], {
    cwd: repoRoot,
    timeout: opts.timeoutMs ?? 10 * 60_000,
    stdout: "pipe",
    stderr: "pipe",
  });
  const duration_ms = Math.max(0, Date.now() - t0);
  const out = Buffer.concat([
    res.stdout as Uint8Array,
    res.stderr as Uint8Array,
  ]);

  const attemptDir = join(repoRoot, "runs", task, "supersede");
  mkdirSync(attemptDir, { recursive: true });
  const artifactRel = `runs/${task}/supersede/out.txt`;
  writeFileSync(join(repoRoot, artifactRel), out);

  const exit = res.exitedDueToTimeout || res.exitCode === null ? null : res.exitCode;
  if (exit !== 0) {
    // Mostra a última linha útil: o operador decide sem abrir o artefato.
    const hint = lastMeaningfulLine(out);
    console.error(
      `supersede: done_when não passa (exit ${exit === null ? "timeout" : exit}); nada a superseder — corrija a task${hint ? `\n  última saída: ${hint}` : ""}`,
    );
    return SUPERSEDE_EXIT.command_failed;
  }

  const attempt = 1 + rows.length;
  const receipt: Receipt = {
    v: 1,
    type: "task.receipt",
    id: randomUUID(),
    task,
    status: "blocked",
    reason_code: "superseded",
    attempts: attempt,
    evidence: [
      {
        kind: "command",
        cmd_sha256: sha256hex(plan.done_when),
        exit: 0,
        duration_ms,
        artifact_ref: { path: artifactRel, sha256: sha256hex(out) },
      },
    ],
    tokens: { ...NOT_RUN_TOKENS.tokens },
    cost_usd: null,
    cost_evidence: "not run: supersede não consome modelo", 
    author: { model: null, family: null },
    verified_by: null,
    next_action: `nenhuma: contrato já verde no base — ${reason}`.slice(0, 280),
    summary: `${task} superseded: done_when exit 0 sem delta de trabalho (${reason})`.slice(
      0,
      280,
    ),
    created_at: new Date().toISOString(),
  };

  ledger.append(receipt);
  console.log(JSON.stringify(receipt));
  return SUPERSEDE_EXIT.ok;
}
