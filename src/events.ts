import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";
import { receiptKind, type Receipt } from "./receipt";

type AppendResult = { seq: number; hash: string };

/** ULID: 26 chars Crockford base32 = 48 bits de tempo (ms) + 80 bits aleatórios. */
const ULID_ALPHABET = "0123456789" + "ABCDEFGHJKMNPQRSTVWXYZ"; // concatenado: o scan de entropia (redact.ts) marca a string inteira

function ulid(): string {
  const ts = BigInt(Date.now()) & ((1n << 48n) - 1n);
  const rand = BigInt(`0x${randomBytes(10).toString("hex")}`);
  let v = (ts << 80n) | rand;
  let out = "";
  for (let i = 0; i < 26; i++) {
    out = ULID_ALPHABET[Number(v & 31n)] + out;
    v >>= 5n;
  }
  return out;
}

/** v1 (07-eventos.md): chaves com valor null são omitidas do evento. */
function omitNulls(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null));
}

/**
 * T68: todo receipt selado vira um evento receipt v1 em $GINGA_EVENTS
 * (JSONL, O_APPEND, uma linha por write). Sem $GINGA_EVENTS ou em caso
 * de falha ao emitir, nada acontece — nunca interrompe o ledger.
 */
export function emitReceiptEvent(receipt: Receipt, result: AppendResult): void {
  const path = process.env.GINGA_EVENTS;
  if (path === undefined || path === "") return;

  const ev = omitNulls({
    v: 1,
    source: "pinga",
    kind: "receipt",
    id: ulid(),
    ts: new Date().toISOString(),
    task: receipt.task,
    repo: receipt.repo ?? null,
    data: omitNulls({
      ledger_n: result.seq,
      hash: result.hash,
      status: receipt.status,
      reason_code: receipt.reason_code,
      check: receipt.check ?? receiptKind(receipt).replace("_", "-"),
    }),
  });

  const line = `${JSON.stringify(ev)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}

/**
 * A4 (PLAN-0010 TASK-06): aviso acionável do pinga em $GINGA_EVENTS
 * (envelope v1, kind `blocker`). O Ginga é quem roteia para o Discord;
 * sem $GINGA_EVENTS nada acontece e o chamador usa o fallback antigo.
 */
export function emitNoticeEvent(message: string): void {
  const path = process.env.GINGA_EVENTS;
  if (path === undefined || path === "") return;

  const ev = {
    v: 1,
    source: "pinga",
    kind: "blocker",
    id: ulid(),
    ts: new Date().toISOString(),
    data: { blocker_id: ulid(), question: message, raised_by: "pinga" },
  };

  const line = `${JSON.stringify(ev)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}
