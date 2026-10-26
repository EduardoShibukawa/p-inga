import { describe, expect, it } from "bun:test";
import { evaluateDocument, renderScorecardMarkdown, runStaticChecks, WEIGHTS } from "../src/docs_eval";
import { openLedger } from "../src/ledger";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("T25 — Documentation Benchmark & LLM-as-a-Judge (P-Ingá v0.6)", () => {
  it("1. runStaticChecks detects bash commands, mermaid diagrams, and flags", () => {
    const doc = `
# Sample Doc
Here is how to run:
\`\`\`bash
gira slice service:order --tier deep
gira architecture --output ARCH.md
\`\`\`

Diagram:
\`\`\`mermaid
flowchart TD
  A[Start] --> B[End]
\`\`\`
`;
    const checks = runStaticChecks(doc, process.cwd());
    expect(checks.totalCommands).toBe(2);
    expect(checks.validCommands).toBe(2);
    expect(checks.mermaidBlocks).toBe(1);
    expect(checks.brokenMermaidBlocks).toBe(0);
  });

  it("2. evaluateDocument calculates weighted global score (0 to 100)", async () => {
    const doc = `
# Title

## Synopsis
\`\`\`bash
gira slice <node_id>
\`\`\`

## Flags
| Flag | Description |
| :--- | :--- |
| --tier | Context tier |

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;
    const res = await evaluateDocument(doc, "docs/cli/slice.md");
    expect(res.globalScore).toBeGreaterThanOrEqual(75);
    expect(res.metrics.gra.score).toBeGreaterThanOrEqual(4);
    expect(res.metrics.ato.score).toBeGreaterThanOrEqual(4);
  });

  it("3. sealEvaluationReceipt writes a cryptographically verifiable receipt in ledger", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pinga-docs-eval-"));
    const ledgerPath = join(dir, "ledger.db");

    try {
      const doc = `# Test\n\`\`\`bash\ngira init .\n\`\`\``;
      const res = await evaluateDocument(doc, "docs/test.md", {
        ledgerPath,
        seal: true,
      });

      const ledger = openLedger(ledgerPath);
      const verifyRes = ledger.verify();
      expect(verifyRes.ok).toBe(true);
      expect(verifyRes.count).toBe(1);

      const receipts = ledger.all();
      expect(receipts[0].task).toBe("docs:docs/test.md");
      expect(receipts[0].status).toBe("pass");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("4. renderScorecardMarkdown formats table with all 6 metrics", async () => {
    const doc = `# Sample\n\`\`\`bash\ngira init .\n\`\`\``;
    const res = await evaluateDocument(doc, "sample.md");
    const md = renderScorecardMarkdown(res);
    expect(md).toContain("Scorecard de Documentação Técnica");
    expect(md).toContain("Groundedness & Reality");
    expect(md).toContain("Actionability & Task");
    expect(md).toContain("Cognitive Density");
    expect(md).toContain("Pedagogical Clarity");
    expect(md).toContain("Visual Legibility");
    expect(md).toContain("Structural Ergonomics");
  });
});
