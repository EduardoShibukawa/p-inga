import { describe, expect, test } from "bun:test";
import { classifyBaseRun } from "../src/prove";

const run = (output: string, exit = 1) =>
  classifyBaseRun({ exit, timedOut: false, output });

describe("T43 — prove-red rejeita RED por erro de import/compilação", () => {
  test("falhas de resolução/compilação são inconclusivas", () => {
    for (const out of [
      "error: Cannot find module './sse' from '/x/tests/sse.test.ts'",
      "error: Module not found \"./sse\"",
      "./main_test.go:9:2: undefined: NewServer\nFAIL\tex [build failed]",
      "main.go:3:8: no required module provides package example.com/x",
      "cannot find package \"foo\" in any of",
      "src/a.ts(3,1): error TS2304: Cannot find name 'sse'.",
      "error TS2307: Cannot find module './sse' or its corresponding type declarations.",
    ]) {
      expect(run(out)).toBe("inconclusive");
    }
  });
  test("falha real de asserção continua provando", () => {
    expect(run("error: expect(received).toBe(expected)\nExpected: 2\nReceived: 1")).toBe("proved");
    expect(run("--- FAIL: TestX (0.00s)\n    x_test.go:5: got 1 want 2\nFAIL")).toBe("proved");
    expect(run("")).toBe("proved");
    expect(run("Cannot find module './sse'", 0)).toBe("test_passed_on_base");
  });
});
