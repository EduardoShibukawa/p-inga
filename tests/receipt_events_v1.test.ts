import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
let dir: string;
const saved = process.env.GINGA_EVENTS;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pinga-ev-v1-"));
  process.env.GINGA_EVENTS = join(dir, "events.jsonl");
});
afterEach(() => {
  if (saved === undefined) delete process.env.GINGA_EVENTS;
  else process.env.GINGA_EVENTS = saved;
  rmSync(dir, { recursive: true, force: true });
});
const receipt = (id: string) => ({
  v: 1, type: "task.receipt", id, task: "T01", status: "pass", reason_code: null, attempts: 1,
  evidence: [{ kind: "command", cmd_sha256: "a".repeat(64), exit: 0, duration_ms: 1,
    artifact_ref: { path: "runs/T01/1/out.txt", sha256: "b".repeat(64) } }],
  tokens: { in: null, out: null, cache: null, source: null }, cost_usd: null, cost_evidence: "not run",
  author: { model: "deepseek-v4-pro", family: "deepseek" }, verified_by: null,
  summary: "T01 pass", created_at: "2026-10-24T17:20:01.000Z",
});

describe("evento receipt satisfaz o envelope v1 (doc 07)", () => {
  test("id é ULID, único, e data não tem campos null", () => {
    const led = openLedger(join(dir, "ledger.db"));
    try { led.append(receipt("r-1")); led.append(receipt("r-2")); } finally { led.close(); }
    const evs = readFileSync(process.env.GINGA_EVENTS!, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(evs).toHaveLength(2);
    for (const ev of evs) {
      expect(ev.id).toMatch(ULID);
      for (const [k, v] of Object.entries(ev.data)) expect([k, v]).not.toEqual([k, null]);
      for (const [k, v] of Object.entries(ev)) expect([k, v]).not.toEqual([k, null]);
    }
    expect(evs[0].id).not.toBe(evs[1].id);
  });
});
