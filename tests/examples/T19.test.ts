// gerado por pinga examples (T10): não editar
// task T19 · conjunto visible · 4 exemplos · sha256 1d8e82db82d0ca1505c9e48778b6652bcc3ba70d9c1f66dba8f12f746bcc0d6f
import { expect, test } from "bun:test";
import { computeAuditGate } from "../../src/audit.ts";

test("ex-2-gate-fail-30", async () => { const args = [{"sample_size":30,"threshold":0.7,"useful_count":18}] as unknown[]; expect(await (computeAuditGate as (...a: unknown[]) => unknown)(...args)).toEqual(false); });
test("ex-3-gate-exact-threshold", async () => { const args = [{"sample_size":10,"threshold":0.7,"useful_count":7}] as unknown[]; expect(await (computeAuditGate as (...a: unknown[]) => unknown)(...args)).toEqual(true); });
test("ex-5-gate-custom-threshold", async () => { const args = [{"sample_size":20,"threshold":0.8,"useful_count":17}] as unknown[]; expect(await (computeAuditGate as (...a: unknown[]) => unknown)(...args)).toEqual(true); });
test("ex-6-gate-high-fail", async () => { const args = [{"sample_size":20,"threshold":0.8,"useful_count":15}] as unknown[]; expect(await (computeAuditGate as (...a: unknown[]) => unknown)(...args)).toEqual(false); });
