import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger } from "../src/ledger";

let dir: string;
let events: string;
const saved = process.env.GINGA_EVENTS;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pinga-events-fix-"));
  events = join(dir, "events.jsonl");
  process.env.GINGA_EVENTS = events;
});
afterEach(() => {
  if (saved === undefined) delete process.env.GINGA_EVENTS;
  else process.env.GINGA_EVENTS = saved;
  rmSync(dir, { recursive: true, force: true });
});

const receipt = (over: Record<string, unknown>) => ({
  v: 1, type: "task.receipt", id: "rcpt-fix-1", task: "T01", status: "pass", reason_code: null, attempts: 1,
  evidence: [{ kind: "command", cmd_sha256: "a".repeat(64), exit: 0, duration_ms: 1,
    artifact_ref: { path: "runs/T01/1/out.txt", sha256: "b".repeat(64) } }],
  tokens: { in: null, out: null, cache: null, source: null }, cost_usd: null, cost_evidence: "not run",
  author: { model: "deepseek-v4-pro", family: "deepseek" }, verified_by: null,
  summary: "T01 pass", created_at: "2026-10-24T17:20:01.000Z", ...over,
});
const lastEvent = () => {
  const ls = (existsSync(events) ? readFileSync(events, "utf8") : "").split("\n").filter(Boolean);
  return JSON.parse(ls[ls.length - 1]!);
};
function append(r: Record<string, unknown>) {
  const led = openLedger(join(dir, "ledger.db"));
  try { return led.append(r); } finally { led.close(); }
}

describe("check do evento receipt", () => {
  test("receipt com check: plan emite data.check = plan", () => {
    append(receipt({ id: "rcpt-plan-1", task: "PLAN-0005", status: "blocked", reason_code: "tasks_open", check: "plan", summary: "PLAN-0005 blocked: tasks_open" }));
    expect(lastEvent().data.check).toBe("plan");
  });
  test("receipt sem check mantém o check derivado (verify)", () => {
    append(receipt({}));
    expect(lastEvent().data.check).toBe("verify");
  });
});
