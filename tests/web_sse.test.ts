import { afterEach, describe, expect, test } from "bun:test";
import * as sse from "../web/sse";

function makeClient() {
  let ctrl!: ReadableStreamDefaultController;
  const stream = new ReadableStream({ start(c) { ctrl = c; } });
  return { ctrl, stream };
}

describe("T41: fechamento de cliente SSE", () => {
  const errors: string[] = [];
  const orig = console.error;
  afterEach(() => { console.error = orig; errors.length = 0; });

  test("cliente desconectado e depois close/broadcast: silencioso e removido uma vez", async () => {
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };
    const { ctrl, stream } = makeClient();
    sse.addSseClient(ctrl);
    expect(sse.sseClientCount()).toBe(1);
    // cliente desconecta: stream fechado por fora
    ctrl.close();
    await stream.cancel().catch(() => {});
    sse.notifySse("ping", { t: 1 });
    expect(sse.closeSseClient(ctrl)).toBe(false);
    expect(sse.closeSseClient(ctrl)).toBe(false);
    sse.closeAllSseClients();
    sse.closeAllSseClients();
    expect(sse.sseClientCount()).toBe(0);
    expect(errors.filter((e) => /already closed|falha ao fechar/i.test(e))).toEqual([]);
  });

  test("close de cliente vivo fecha uma vez e remove", () => {
    console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };
    const { ctrl } = makeClient();
    sse.addSseClient(ctrl);
    expect(sse.closeSseClient(ctrl)).toBe(true);
    expect(sse.closeSseClient(ctrl)).toBe(false);
    sse.closeAllSseClients();
    expect(sse.sseClientCount()).toBe(0);
    expect(errors).toEqual([]);
  });
});
