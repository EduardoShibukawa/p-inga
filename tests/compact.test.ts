import { describe, expect, test } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { compactContext, type ContextMessage } from "../src/compact";

describe("T22 — Context Compactor (P-Ingá v0.5)", () => {
  test("1. Retorna mensagens inalteradas quando total de caracteres <= maxChars", () => {
    const messages: ContextMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello world" },
      { role: "assistant", content: "Hi! How can I help?" },
    ];

    const result = compactContext(messages, { maxChars: 1000 });
    expect(result.compacted).toBe(false);
    expect(result.charsSaved).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  test("2. Poda observações antigas de ferramentas (> 300 chars) quando excede maxChars", () => {
    const hugeObservation = "x".repeat(2000);
    const messages: ContextMessage[] = [
      { role: "system", content: "You are an agent." },
      { role: "user", content: "Analyze codebase" },
      { role: "assistant", tool_calls: [{ id: "c1", function: { name: "read_file" } }] },
      { role: "tool", tool_call_id: "c1", content: hugeObservation },
      // 6 mensagens recentes que devem ficar intactas
      { role: "assistant", content: "Processing..." },
      { role: "assistant", tool_calls: [{ id: "c2", function: { name: "edit_file" } }] },
      { role: "tool", tool_call_id: "c2", content: "edited line 10" },
      { role: "assistant", content: "Verifying tests..." },
      { role: "assistant", tool_calls: [{ id: "c3", function: { name: "run_tests" } }] },
      { role: "tool", tool_call_id: "c3", content: "6 passed" },
    ];

    const result = compactContext(messages, { maxChars: 1500, maxObservationChars: 300 });
    expect(result.compacted).toBe(true);
    expect(result.charsSaved).toBeGreaterThan(1500);

    const oldToolMsg = result.messages[3];
    expect(oldToolMsg.content).toBeDefined();
    expect(oldToolMsg.content!.includes("[p-inga: trimmed")).toBe(true);
    expect(oldToolMsg.content!.length).toBeLessThan(500);
  });

  test("3. Preserva o prompt de sistema e o prompt inicial do usuário 100% intactos", () => {
    const systemPrompt = "System instruction with critical rules ".repeat(50);
    const userPrompt = "User goal with detailed requirements ".repeat(50);
    const messages: ContextMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
      { role: "tool", tool_call_id: "c1", content: "result ".repeat(500) },
      { role: "assistant", content: "recent 1" },
      { role: "user", content: "recent 2" },
      { role: "assistant", content: "recent 3" },
      { role: "user", content: "recent 4" },
      { role: "assistant", content: "recent 5" },
      { role: "user", content: "recent 6" },
    ];

    const result = compactContext(messages, { maxChars: 500 });
    expect(result.messages[0].content).toBe(systemPrompt);
    expect(result.messages[1].content).toBe(userPrompt);
  });

  test("4. Mantém as últimas N mensagens recentes completamente intactas", () => {
    const recentToolContent = "Recent observation that must NOT be trimmed ".repeat(20);
    const messages: ContextMessage[] = [
      { role: "system", content: "System" },
      { role: "user", content: "User" },
      { role: "tool", tool_call_id: "old1", content: "old ".repeat(300) },
      // Últimas 3 mensagens (com keepRecentMessages: 3)
      { role: "assistant", content: "A" },
      { role: "tool", tool_call_id: "recent1", content: recentToolContent },
      { role: "assistant", content: "B" },
    ];

    const result = compactContext(messages, { maxChars: 200, keepRecentMessages: 3 });
    const lastTool = result.messages[4];
    expect(lastTool.content).toBe(recentToolContent);
    expect(lastTool.content!.includes("[p-inga: trimmed")).toBe(false);
  });

  test("5. Não poda observações de ferramenta curtas (<= maxObservationChars)", () => {
    const shortObservation = "All 5 tests passed in 20ms.";
    const messages: ContextMessage[] = [
      { role: "system", content: "System" },
      { role: "user", content: "User" },
      { role: "tool", tool_call_id: "c1", content: shortObservation },
      { role: "tool", tool_call_id: "c2", content: "z".repeat(2000) },
      { role: "assistant", content: "1" },
      { role: "user", content: "2" },
      { role: "assistant", content: "3" },
      { role: "user", content: "4" },
      { role: "assistant", content: "5" },
      { role: "user", content: "6" },
    ];

    const result = compactContext(messages, { maxChars: 500, maxObservationChars: 300 });
    expect(result.messages[2].content).toBe(shortObservation);
  });

  test("6. CLI pinga compact lê transcript e gera JSON compactado", () => {
    const tmpFile = `/tmp/test-compact-${Date.now()}.json`;
    const messages = [
      { role: "system", content: "System" },
      { role: "user", content: "Goal" },
      { role: "tool", tool_call_id: "c0", content: "big ".repeat(500) },
      { role: "assistant", content: "m1" },
      { role: "user", content: "m2" },
      { role: "assistant", content: "m3" },
      { role: "user", content: "m4" },
      { role: "assistant", content: "m5" },
      { role: "user", content: "m6" },
    ];
    writeFileSync(tmpFile, JSON.stringify(messages, null, 2));

    try {
      const proc = Bun.spawnSync(
        ["bun", "src/cli.ts", "compact", tmpFile, "--max-chars", "400"],
        { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" }
      );
      expect(proc.exitCode).toBe(0);
      const output = JSON.parse(proc.stdout.toString().trim());
      expect(Array.isArray(output)).toBe(true);
      expect(output.length).toBe(messages.length);
      expect(output[2].content.includes("[p-inga: trimmed")).toBe(true);
    } finally {
      try { unlinkSync(tmpFile); } catch {}
    }
  });
});
