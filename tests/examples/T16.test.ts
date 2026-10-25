// gerado por pinga examples (T10): não editar
// task T16 · conjunto visible · 4 exemplos · sha256 43f26c2ca188a7d7d32a9ecee58ad57f2564a95eddb040a546dcf952e03b2a53
import { expect, test } from "bun:test";
import { isForbiddenPath } from "../../src/transcript.ts";

test("ex-2-env-file", async () => { const args = ["~/.hermes/.env"] as unknown[]; expect(await (isForbiddenPath as (...a: unknown[]) => unknown)(...args)).toEqual(true); });
test("ex-4-secrets-dir", async () => { const args = ["/home/user/project/secrets/api_key.txt"] as unknown[]; expect(await (isForbiddenPath as (...a: unknown[]) => unknown)(...args)).toEqual(true); });
test("ex-5-valid-transcript", async () => { const args = ["/home/user/.pi/agent/sessions/abc.jsonl"] as unknown[]; expect(await (isForbiddenPath as (...a: unknown[]) => unknown)(...args)).toEqual(false); });
test("ex-6-valid-markdown", async () => { const args = ["/home/user/project/FRICTION.md"] as unknown[]; expect(await (isForbiddenPath as (...a: unknown[]) => unknown)(...args)).toEqual(false); });
