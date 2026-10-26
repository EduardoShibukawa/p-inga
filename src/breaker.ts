import { createHash } from "node:crypto";
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

export function lastReceiptFor(ledger: Ledger, task: string): Receipt | null {
  const receipts = ledger
    .all()
    .filter((r) => r.task === task)
    .map((r) => JSON.parse(r.body) as Receipt)
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
};

export type InertiaResult = {
  tripped: boolean;
  consecutiveReads: number;
  warning?: string;
};

/**
 * Invariante I6: Disjuntor de Inércia (Read-Loop Breaker).
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
    } else {
      break;
    }
  }

  if (consecutiveReads >= threshold) {
    return {
      tripped: true,
      consecutiveReads,
      warning: `DISJUNTOR P-INGÁ (Invariante I6): ${consecutiveReads} leituras consecutivas sem intervenção. O código não avança apenas com observação. Formule uma hipótese de teste ou execute uma alteração pontual agora.`,
    };
  }

  return {
    tripped: false,
    consecutiveReads,
  };
}

