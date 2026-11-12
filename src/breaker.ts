import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { canonicalJson } from "./canonical";
import type { Ledger } from "./ledger";
import type { ReasonCode, Receipt } from "./receipt";
import { receiptKind } from "./receipt";

export const BREAKER_EXIT = 4;
export const BREAKER_NEXT_ACTION = "escalar ao dono";

export type FailureInput = {
  exit: number | null;
  out_sha256: string | null;
  reason_code: ReasonCode | null;
};

export function computeFailureSignature(f: FailureInput): string {
  const payload = canonicalJson({
    exit: f.exit,
    out_sha256: f.out_sha256,
    reason_code: f.reason_code,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/** Pasta do pacote dentro do repositório (`git rev-parse --show-prefix`), sem barra final; "" na raiz. */
export function packagePrefix(repoRoot: string): string {
  const r = Bun.spawnSync(["git", "rev-parse", "--show-prefix"], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) return "";
  return r.stdout.toString().trim().replace(/\/+$/, "");
}

/**
 * Escopo estável do repo: realpath do git common dir (igual entre worktrees).
 * T904 (monorepo): quando a raiz é uma subpasta do repositório, o escopo é do
 * pacote — `<git common dir>#<pasta>` — e o mesmo `T<N>` em dois pacotes não colide.
 */
export function repoScope(repoRoot: string): string | undefined {
  const r = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) return undefined;
  try {
    const common = realpathSync(r.stdout.toString().trim());
    const pkg = packagePrefix(repoRoot);
    return pkg === "" ? common : `${common}#${pkg}`;
  } catch {
    return undefined;
  }
}

/**
 * O receipt pertence a este escopo? Igual, ou — para um pacote de monorepo —
 * gravado quando o pacote era um repositório separado: o `.git` de uma pasta
 * com o mesmo nome (`…/<pasta>/.git`). Receipts antigos continuam valendo.
 */
export function sameScope(receiptRepo: unknown, scope: string): boolean {
  if (typeof receiptRepo !== "string") return false;
  if (receiptRepo === scope) return true;
  const at = scope.lastIndexOf("#");
  if (at === -1 || receiptRepo.includes("#")) return false;
  return receiptRepo.endsWith(`/${scope.slice(at + 1)}/.git`);
}

/** Recibos da task no escopo do repo; legados (sem `repo`) não pertencem a nenhum escopo. */
export function scopedReceipts(ledger: Ledger, task: string, repo?: string): Receipt[] {
  return ledger
    .all()
    .filter((r) => r.task === task)
    .map((r) => JSON.parse(r.body) as Receipt)
    .filter((rcpt) => repo === undefined || sameScope(rcpt.repo, repo));
}

export function lastReceiptFor(ledger: Ledger, task: string, repo?: string): Receipt | null {
  const receipts = scopedReceipts(ledger, task, repo)
    .filter((rcpt) => receiptKind(rcpt) === "verify");
  if (receipts.length === 0) return null;
  return receipts[receipts.length - 1]!;
}

export function shouldTrip(prev: Receipt | null, signature: string): boolean {
  if (prev === null) return false;
  if (prev.status !== "fail" && prev.status !== "blocked") return false;
  return prev.breaker?.failure_signature === signature;
}

export const INERTIA_READ_THRESHOLD = 3;

export type InertiaActionType = "read" | "write" | "test";

export type InertiaAction = {
  type: InertiaActionType;
  target?: string;
  success?: boolean;
};

export type InertiaResult = {
  tripped: boolean;
  consecutiveReads: number;
  warning?: string;
};

/**
 * Guardrail G1: Disjuntor de Inércia (Read-Loop Breaker).
 * Monitora o histórico recente de ações do agente.
 * Se o agente encadear N leituras consecutivas sem mutação ou execução de teste,
 * o disjuntor de inércia dispara uma intervenção reflexiva.
 */
export function evaluateInertia(
  history: InertiaAction[],
  threshold = INERTIA_READ_THRESHOLD
): InertiaResult {
  let consecutiveReads = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const act = history[i]!;
    if (act.type === "read") {
      consecutiveReads++;
    } else if (act.type === "write" && act.success === false) {
      // Falha em mutação: trata como tentativa falhada sem zerar inércia
      continue;
    } else {
      break;
    }
  }

  if (consecutiveReads >= threshold) {
    return {
      tripped: true,
      consecutiveReads,
      warning: `DISJUNTOR P-INGÁ (Guardrail G1 - Inércia): ${consecutiveReads} leituras consecutivas sem intervenção. O código não avança apenas com observação. Formule uma hipótese de teste ou execute uma alteração pontual agora.`,
    };
  }

  return {
    tripped: false,
    consecutiveReads,
  };
}

