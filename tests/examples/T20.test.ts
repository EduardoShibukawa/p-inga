// gerado por pinga examples (T10): não editar
// task T20 · conjunto visible · 4 exemplos · sha256 aac3444c3f6b94eff2f9a8961af10a93a7a02cf64e6ba3baeff574568cd49618
import { expect, test } from "bun:test";
import { truncateEnvelopeString } from "../../src/maestro.ts";

test("ex-2-exact-limit", async () => { const args = ["exactlimit",10] as unknown[]; expect(await (truncateEnvelopeString as (...a: unknown[]) => unknown)(...args)).toEqual("exactlimit"); });
test("ex-3-truncate-simple", async () => { const args = ["abcdefghij",5] as unknown[]; expect(await (truncateEnvelopeString as (...a: unknown[]) => unknown)(...args)).toEqual("abcde"); });
test("ex-4-zero-limit", async () => { const args = ["test",0] as unknown[]; expect(await (truncateEnvelopeString as (...a: unknown[]) => unknown)(...args)).toEqual(""); });
test("ex-5-truncate-multibyte", async () => { const args = ["áéíóú",4] as unknown[]; expect(await (truncateEnvelopeString as (...a: unknown[]) => unknown)(...args)).toEqual("áé"); });
