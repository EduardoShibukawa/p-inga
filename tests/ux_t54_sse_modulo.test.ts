import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SERVER = readFileSync(join(ROOT, "web/server.ts"), "utf8");
const SSE = readFileSync(join(ROOT, "web/sse.ts"), "utf8");

/**
 * Dívida do merge main (0825bf5) × task/ux-unificado:
 * main extraiu o hub de SSE para `web/sse.ts` (T41) e o painel UX reescreveu o
 * servidor com um `Set` de controllers próprio. As duas implementações coexistem
 * e só a interna é usada — `web/sse.ts` ficou órfão, com teste verde que prova
 * nada sobre o servidor que roda.
 */
describe("T54 · hub de SSE único", () => {
  test("server.ts consome o módulo web/sse.ts", () => {
    expect(SERVER).toMatch(/from "\.\/sse\.ts"/);
  });

  test("não resta conjunto de controllers local no servidor", () => {
    expect(SERVER).not.toMatch(/new Set<ReadableStreamDefaultController>/);
  });

  test("todo export de web/sse.ts é referenciado pelo servidor", () => {
    const exported = [...SSE.matchAll(/^export function (\w+)/gm)].map((m) => m[1]!);
    expect(exported.length).toBeGreaterThanOrEqual(6);
    const orfaos = exported.filter((fn) => !new RegExp(`\\b${fn}\\b`).test(SERVER));
    expect(orfaos).toEqual([]);
  });

  test("o hub entrega frames e fecha clientes", async () => {
    const sse = await import("../web/sse.ts");
    expect(sse.sseClientCount()).toBe(0);

    const frames: string[] = [];
    const ctrl = {
      enqueue: (chunk: Uint8Array) => frames.push(new TextDecoder().decode(chunk)),
      close: () => {},
    } as unknown as ReadableStreamDefaultController;

    sse.addSseClient(ctrl);
    expect(sse.sseClientCount()).toBe(1);
    sse.notifySse("tick", { n: 1 });
    expect(frames.join("")).toContain("event: tick");
    expect(frames.join("")).toContain('"n":1');

    expect(sse.closeSseClient(ctrl)).toBe(true);
    expect(sse.sseClientCount()).toBe(0);
  });
});
