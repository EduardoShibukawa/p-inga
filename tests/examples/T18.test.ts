// gerado por pinga examples (T10): não editar
// task T18 · conjunto visible · 4 exemplos · sha256 d5e32fa417c769846d8b4d0d1767693ab063155837a5aa79ac075f456926614e
import { expect, test } from "bun:test";
import { classifyAdoptTarget } from "../../src/adopt.ts";

test("ex-2-broken-symlink", async () => { const args = [{"exists":false,"is_broken_symlink":true,"is_owned":false,"target":"pi-symlink"}] as unknown[]; expect(await (classifyAdoptTarget as (...a: unknown[]) => unknown)(...args)).toEqual("broken_symlink"); });
test("ex-3-missing-file", async () => { const args = [{"exists":false,"is_broken_symlink":false,"is_owned":false,"target":"missing"}] as unknown[]; expect(await (classifyAdoptTarget as (...a: unknown[]) => unknown)(...args)).toEqual("missing"); });
test("ex-5-opencode-plugin", async () => { const args = [{"exists":true,"is_broken_symlink":false,"is_owned":false,"target":"opencode-local"}] as unknown[]; expect(await (classifyAdoptTarget as (...a: unknown[]) => unknown)(...args)).toEqual("adoptable"); });
test("ex-6-unrelated-file", async () => { const args = [{"exists":true,"is_broken_symlink":false,"is_owned":false,"target":"random-file"}] as unknown[]; expect(await (classifyAdoptTarget as (...a: unknown[]) => unknown)(...args)).toEqual("ignored"); });
