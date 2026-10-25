import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_DETECTORS,
  CORRECTION_MARKERS_PT_EN,
  detectAll,
  detectUserCorrection,
  isHumanCorrectionPrompt,
} from "../src/detect";
import { ingestUserTurns, openLearnDb } from "../src/learn";

describe("T17 — High-precision user_correction detector", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pinga-t17-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("1. isHumanCorrectionPrompt returns true for short PT/EN correction prompts after tool failure or before edit", () => {
    expect(CORRECTION_MARKERS_PT_EN).toBeInstanceOf(RegExp);
    expect(
      isHumanCorrectionPrompt({
        text: "não, reverte isso",
        preceding_tool_failed: true,
      }),
    ).toBe(true);
    expect(
      isHumanCorrectionPrompt({
        text: "wrong file, don't edit that",
        preceding_tool_failed: true,
      }),
    ).toBe(true);
    expect(
      isHumanCorrectionPrompt({
        text: "pare, isso está errado",
        preceding_tool_failed: true,
      }),
    ).toBe(true);
  });

  test("2. isHumanCorrectionPrompt returns false for approvals, empty strings, or normal prompts", () => {
    expect(
      isHumanCorrectionPrompt({
        text: "ok, prossiga",
        preceding_tool_failed: true,
      }),
    ).toBe(false);
    expect(
      isHumanCorrectionPrompt({
        text: "ótimo, continue",
        preceding_tool_failed: false,
      }),
    ).toBe(false);
    expect(isHumanCorrectionPrompt({ text: "" })).toBe(false);
  });

  test("3, 4 & 5. isHumanCorrectionPrompt filters out >400 char prompts, sidechains, and <TASK>/<SYSTEM_MESSAGE>", () => {
    expect(
      isHumanCorrectionPrompt({
        text: `não faça isso ${"x".repeat(405)}`,
        preceding_tool_failed: true,
      }),
    ).toBe(false);
    expect(
      isHumanCorrectionPrompt({
        text: "não, reverte isso",
        is_sidechain: true,
        preceding_tool_failed: true,
      }),
    ).toBe(false);
    expect(
      isHumanCorrectionPrompt({
        text: "<TASK> não toque fora do escopo",
        preceding_tool_failed: true,
      }),
    ).toBe(false);
    expect(
      isHumanCorrectionPrompt({
        text: "<SYSTEM_MESSAGE> wrong output",
        preceding_tool_failed: true,
      }),
    ).toBe(false);
    expect(
      isHumanCorrectionPrompt({
        text: "[Message] stop task",
        preceding_tool_failed: true,
      }),
    ).toBe(false);
  });

  test("6, 7 & 8. ingestUserTurns, detectUserCorrection, and detectAll (6 detectors)", () => {
    expect(ALL_DETECTORS.length).toBe(6);
    expect(ALL_DETECTORS).toContain("user_correction");

    const db = openLearnDb(join(tmp, "learn.db"));
    const count = ingestUserTurns(db, "claude:sess-corr-1", [
      {
        text: "não, você editou o arquivo errado, reverte!",
        is_sidechain: false,
        preceding_tool_failed: true,
      },
      {
        text: "<TASK> subagent prompt with não inside",
        is_sidechain: true,
        preceding_tool_failed: true,
      },
      {
        text: "perfeito, pode continuar",
        is_sidechain: false,
        preceding_tool_failed: false,
      },
    ]);
    expect(count).toBe(3);

    const corrCandidates = detectUserCorrection(db);
    expect(corrCandidates.length).toBe(1);
    expect(corrCandidates[0]!.detector).toBe("user_correction");
    expect(corrCandidates[0]!.session_id).toBe("claude:sess-corr-1");
    expect(corrCandidates[0]!.excerpt.length).toBeLessThanOrEqual(300);

    const all = detectAll(db);
    expect(all.candidates.some((c) => c.detector === "user_correction")).toBe(
      true,
    );
    db.close();
  });

  test("9. Synthetic precision benchmark: >= 90% precision on 20 positive + 20 negative cases", () => {
    const positives = [
      { text: "não, reverte isso", preceding_tool_failed: true },
      { text: "errado, desfaça", preceding_tool_failed: true },
      { text: "pare, não edite tests/", preceding_tool_failed: true },
      { text: "volta para a versão anterior", preceding_tool_failed: true },
      { text: "corrija o import", preceding_tool_failed: true },
      { text: "use bun:sqlite em vez disso", preceding_tool_failed: true },
      { text: "no, revert that commit", preceding_tool_failed: true },
      { text: "wrong path, stop", preceding_tool_failed: true },
      { text: "undo the last change", preceding_tool_failed: true },
      { text: "don't touch frozen tests", preceding_tool_failed: true },
      { text: "dont use npm packages", preceding_tool_failed: true },
      { text: "use worktree instead", preceding_tool_failed: true },
      { text: "incorrect exit code", preceding_tool_failed: true },
      { text: "nao rode com --no-verify", preceding_tool_failed: true },
      { text: "desfaca a alteracao em cli.ts", preceding_tool_failed: true },
      { text: "no, that broke the build", preceding_tool_failed: true },
      { text: "wrong branch, revert", preceding_tool_failed: true },
      { text: "pare imediatamente", preceding_tool_failed: true },
      { text: "errado, faltou o --base", preceding_tool_failed: true },
      { text: "stop editing that file", preceding_tool_failed: true },
    ];

    const negatives = [
      { text: "sim, pode continuar", preceding_tool_failed: false },
      { text: "ok, vamos para a próxima", preceding_tool_failed: false },
      { text: "perfeito, ficou ótimo", preceding_tool_failed: true },
      { text: "rode os testes agora", preceding_tool_failed: false },
      { text: "faça o commit", preceding_tool_failed: false },
      { text: "<TASK> não altere tests_frozen", preceding_tool_failed: true },
      { text: "<SYSTEM_MESSAGE> stop execution", preceding_tool_failed: true },
      { text: "[Message] wrong parameter", preceding_tool_failed: true },
      { text: "não, reverte", is_sidechain: true, preceding_tool_failed: true },
      { text: "wrong file", is_sidechain: true, preceding_tool_failed: true },
      { text: `não ${"a".repeat(410)}`, preceding_tool_failed: true },
      { text: "", preceding_tool_failed: true },
      { text: "   ", preceding_tool_failed: true },
      { text: "não, reverte isso", preceding_tool_failed: false },
      { text: "continue o plano", preceding_tool_failed: true },
      { text: "muito bom", preceding_tool_failed: true },
      { text: "avançar para T18", preceding_tool_failed: true },
      { text: "gerar relatório", preceding_tool_failed: true },
      { text: "verificar status", preceding_tool_failed: true },
      { text: "obrigado", preceding_tool_failed: true },
    ];

    let tp = 0;
    let fp = 0;
    for (const p of positives) {
      if (isHumanCorrectionPrompt(p)) tp++;
    }
    for (const n of negatives) {
      if (isHumanCorrectionPrompt(n)) fp++;
    }
    const precision = tp / (tp + fp);
    expect(tp).toBe(20);
    expect(fp).toBe(0);
    expect(precision).toBeGreaterThanOrEqual(0.9);
  });
});
