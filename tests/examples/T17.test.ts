// gerado por pinga examples (T10): não editar
// task T17 · conjunto visible · 4 exemplos · sha256 a655a606ec6784e4ed984e0abe963c932671bedcada5daec864e542e4edb8d00
import { expect, test } from "bun:test";
import { isHumanCorrectionPrompt } from "../../src/detect.ts";

test("ex-1-revert-pt", async () => { const args = [{"preceding_tool_failed":true,"text":"não, reverte essa mudança"}] as unknown[]; expect(await (isHumanCorrectionPrompt as (...a: unknown[]) => unknown)(...args)).toEqual(true); });
test("ex-2-wrong-en", async () => { const args = [{"preceding_tool_failed":true,"text":"wrong file, stop"}] as unknown[]; expect(await (isHumanCorrectionPrompt as (...a: unknown[]) => unknown)(...args)).toEqual(true); });
test("ex-5-positive-approval", async () => { const args = [{"preceding_tool_failed":false,"text":"perfeito, continue assim"}] as unknown[]; expect(await (isHumanCorrectionPrompt as (...a: unknown[]) => unknown)(...args)).toEqual(false); });
test("ex-6-long-system-prompt", async () => { const args = [{"preceding_tool_failed":false,"text":"<TASK> Execute as mudanças sem interrupção"}] as unknown[]; expect(await (isHumanCorrectionPrompt as (...a: unknown[]) => unknown)(...args)).toEqual(false); });
