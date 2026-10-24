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
