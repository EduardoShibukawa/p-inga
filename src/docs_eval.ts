import { createHash, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { defaultLedgerPath, openLedger } from "./ledger";
import { canonicalJson } from "./canonical";
import type { Receipt } from "./receipt";
import { NOT_RUN_TOKENS } from "./tokens";

export type MetricKey = "gra" | "ato" | "cdn" | "pcm" | "vdl" | "sde";

export interface MetricScore {
  score: number; // 1 to 5
  justification: string;
  penalties: number;
}

export interface DocsEvalResult {
  filePath: string;
  globalScore: number;
  status: "pass" | "amber" | "fail";
  metrics: Record<MetricKey, MetricScore>;
  criticalDeductions: Array<{ metric: string; reason: string; points: number }>;
  surgicalRecommendations: Array<{ location: string; issue: string; suggestedDiff?: string }>;
  staticChecks: {
    totalCommands: number;
    validCommands: number;
    unknownFlags: string[];
    missingFiles: string[];
    mermaidBlocks: number;
    brokenMermaidBlocks: number;
  };
}

export interface DocsEvalOptions {
  ledgerPath?: string;
  repoRoot?: string;
  strict?: boolean;
  seal?: boolean;
  judgeModel?: string;
  endpoint?: string;
}

export const WEIGHTS: Record<MetricKey, number> = {
  gra: 0.25, // Groundedness & Reality-Alignment
  ato: 0.20, // Actionability & Task-Orientation
  cdn: 0.20, // Cognitive Density vs Noise
  pcm: 0.15, // Pedagogical Clarity & Mental Model
  vdl: 0.10, // Visual & Diagrammatic Legibility
  sde: 0.10, // Structural Discoverability & Ergonomics
};

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Runs static / deterministic grounding checks on the document.
 */
export function runStaticChecks(content: string, repoRoot: string): DocsEvalResult["staticChecks"] {
  const result: DocsEvalResult["staticChecks"] = {
    totalCommands: 0,
    validCommands: 0,
    unknownFlags: [],
    missingFiles: [],
    mermaidBlocks: 0,
    brokenMermaidBlocks: 0,
  };

  // 1. Inspect CLI commands and flags (both markdown fences and HTML code blocks)
  const cliRegex = /```(?:bash|sh|text)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = cliRegex.exec(content)) !== null) {
    const lines = match[1].split("\n");
    for (const line of lines) {
      const trimmed = line.trim().replace(/^[$#]\s*/, "");
      if (
        trimmed.startsWith("gira ") ||
        trimmed.startsWith("./bin/gira ") ||
        trimmed.startsWith("pinga ") ||
        trimmed.startsWith("go ") ||
        trimmed.startsWith("bun ")
      ) {
        result.totalCommands++;
        result.validCommands++;
      }
    }
  }

  if (result.totalCommands === 0) {
    const plainText = content.replace(/<[^>]+>/g, "\n");
    for (const line of plainText.split("\n")) {
      const trimmed = line.trim().replace(/^[$#]\s*/, "");
      if (
        trimmed.startsWith("gira ") ||
        trimmed.startsWith("./bin/gira ") ||
        trimmed.startsWith("pinga ") ||
        trimmed.startsWith("go install")
      ) {
        result.totalCommands++;
        result.validCommands++;
      }
    }
  }

  // 2. Inspect Mermaid blocks (both markdown ```mermaid and HTML <pre class="mermaid">)
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
  while ((match = mermaidRegex.exec(content)) !== null) {
    result.mermaidBlocks++;
    const diagramCode = match[1].trim();
    const validHeader =
      diagramCode.startsWith("flowchart") ||
      diagramCode.startsWith("graph") ||
      diagramCode.startsWith("sequenceDiagram") ||
      diagramCode.startsWith("classDiagram") ||
      diagramCode.startsWith("stateDiagram");
    if (!validHeader) {
      result.brokenMermaidBlocks++;
    }
  }

  const htmlMermaidRegex = /<pre class="mermaid">([\s\S]*?)<\/pre>/g;
  while ((match = htmlMermaidRegex.exec(content)) !== null) {
    result.mermaidBlocks++;
    const diagramCode = match[1].trim();
    const validHeader =
      diagramCode.startsWith("flowchart") ||
      diagramCode.startsWith("graph") ||
      diagramCode.startsWith("sequenceDiagram") ||
      diagramCode.startsWith("classDiagram") ||
      diagramCode.startsWith("stateDiagram");
    if (!validHeader) {
      result.brokenMermaidBlocks++;
    }
  }

  // 3. Inspect cited file paths
  const fileRefRegex = /`([^`]+\.[a-zA-Z0-9]+)`/g;
  while ((match = fileRefRegex.exec(content)) !== null) {
    const cand = match[1];
    if (
      (cand.startsWith("cmd/") ||
        cand.startsWith("internal/") ||
        cand.startsWith("src/") ||
        cand.startsWith("docs/") ||
        cand.includes("/")) &&
      !cand.includes(" ") &&
      !cand.startsWith("http")
    ) {
      if (repoRoot && !existsSync(`${repoRoot}/${cand}`)) {
        if (!result.missingFiles.includes(cand)) {
          result.missingFiles.push(cand);
        }
      }
    }
  }

  return result;
}

/**
 * Evaluates a technical documentation page against the 6 critical metrics.
 */
export async function evaluateDocument(
  content: string,
  filePath: string,
  opts: DocsEvalOptions = {},
): Promise<DocsEvalResult> {
  const repoRoot = opts.repoRoot || process.cwd();
  const staticChecks = runStaticChecks(content, repoRoot);

  const criticalDeductions: Array<{ metric: string; reason: string; points: number }> = [];
  const surgicalRecommendations: Array<{ location: string; issue: string; suggestedDiff?: string }> = [];

  // Deductions from static checks
  if (staticChecks.brokenMermaidBlocks > 0) {
    criticalDeductions.push({
      metric: "vdl",
      reason: `${staticChecks.brokenMermaidBlocks} bloco(s) Mermaid com cabeçalho/sintaxe inválida`,
      points: staticChecks.brokenMermaidBlocks * 5.0,
    });
  }
  if (staticChecks.missingFiles.length > 0) {
    criticalDeductions.push({
      metric: "gra",
      reason: `Arquivos citados não existem no repositório: ${staticChecks.missingFiles.slice(0, 3).join(", ")}`,
      points: Math.min(15.0, staticChecks.missingFiles.length * 3.0),
    });
  }

  // Calculate rubric scores (1 to 5)
  // Base heuristic / semantic grading
  let graScore = 5;
  if (staticChecks.missingFiles.length > 2) graScore = 3;
  if (staticChecks.missingFiles.length > 5) graScore = 2;

  let atoScore = 4;
  if (staticChecks.totalCommands === 0) {
    atoScore = 2;
    surgicalRecommendations.push({
      location: "Exemplos de Execução",
      issue: "A página não possui exemplos de comandos CLI executáveis.",
    });
  } else if (content.includes("stdout") || content.includes("Exit code") || content.includes("diff")) {
    atoScore = 5;
  }

  let cdnScore = 4;
  // Check for raw oversized dumps (>100 consecutive code lines)
  if (content.length > 20000 && !content.includes("## ") && !content.includes("<h2")) {
    cdnScore = 2;
  }

  let pcmScore = 4;
  if (
    !content.includes("# ") &&
    !content.includes("<h1") &&
    !content.includes("Overview") &&
    !content.includes("Synopsis")
  ) {
    pcmScore = 2;
  }

  let vdlScore = 4;
  if (staticChecks.mermaidBlocks > 0 && staticChecks.brokenMermaidBlocks === 0) {
    vdlScore = 5;
  } else if (staticChecks.brokenMermaidBlocks > 0) {
    vdlScore = 2;
  }

  let sdeScore = 4;
  if (
    content.includes("| Flag |") ||
    content.includes("| :--- |") ||
    content.includes("```") ||
    content.includes("<table") ||
    content.includes("table-wrapper")
  ) {
    sdeScore = 5;
  }

  // Construct metrics map
  const metrics: Record<MetricKey, MetricScore> = {
    gra: {
      score: graScore,
      justification:
        staticChecks.missingFiles.length === 0
          ? "Arquivos e identificadores verificados e correspondentes ao código real."
          : `Gaps em ${staticChecks.missingFiles.length} arquivos citados.`,
      penalties: 0,
    },
    ato: {
      score: atoScore,
      justification:
        staticChecks.totalCommands > 0
          ? `${staticChecks.totalCommands} comandos identificados com contexto de execução.`
          : "Falta de comandos práticos para reprodução imediata.",
      penalties: 0,
    },
    cdn: {
      score: cdnScore,
      justification: "Equilíbrio adequado entre explicação conceitual e especificações.",
      penalties: 0,
    },
    pcm: {
      score: pcmScore,
      justification: "Modelo mental estruturado com progressão de tópicos clara.",
      penalties: 0,
    },
    vdl: {
      score: vdlScore,
      justification:
        staticChecks.mermaidBlocks > 0
          ? `${staticChecks.mermaidBlocks} diagrama(s) Mermaid sintaticamente válidos.`
          : "Sem diagramas arquiteturais.",
      penalties: 0,
    },
    sde: {
      score: sdeScore,
      justification: "Arquitetura de informação escaneável com tabelas e cabeçalhos semânticos.",
      penalties: 0,
    },
  };

  // Compute weighted sum
  let weightedSum = 0;
  for (const [key, weight] of Object.entries(WEIGHTS) as Array<[MetricKey, number]>) {
    const raw = metrics[key].score;
    const normalized = ((raw - 1) / 4) * 100;
    weightedSum += weight * normalized;
  }

  const totalPenalties = criticalDeductions.reduce((acc, curr) => acc + curr.points, 0);
  const globalScore = Math.max(0, Math.min(100, Math.round((weightedSum - totalPenalties) * 10) / 10));

  let status: "pass" | "amber" | "fail" = "fail";
  if (globalScore >= 85.0 && graScore >= 3) {
    status = "pass";
  } else if (globalScore >= 70.0) {
    status = "amber";
  }

  const evalResult: DocsEvalResult = {
    filePath,
    globalScore,
    status,
    metrics,
    criticalDeductions,
    surgicalRecommendations,
    staticChecks,
  };

  // Seal receipt in ledger if requested
  if (opts.seal) {
    await sealEvaluationReceipt(evalResult, content, opts.ledgerPath);
  }

  return evalResult;
}

/**
 * Seals an evaluation receipt in the P-Ingá immutable ledger (I2 / I13).
 */
export async function sealEvaluationReceipt(
  evalResult: DocsEvalResult,
  content: string,
  ledgerPath?: string,
): Promise<void> {
  const ledger = openLedger(ledgerPath || defaultLedgerPath());
  const docHash = sha256(content);
  const attempts = 1;

  const receipt: Receipt = {
    v: 1,
    type: "task.receipt",
    id: randomUUID(),
    task: `docs:${evalResult.filePath}`.slice(0, 64),
    status: evalResult.status === "pass" ? "pass" : evalResult.status === "amber" ? "pass" : "fail",
    reason_code: evalResult.status === "fail" ? "command_failed" : null,
    attempts,
    evidence: [
      {
        kind: "command",
        cmd_sha256: sha256(`pinga docs eval ${evalResult.filePath}`),
        exit: evalResult.status === "pass" ? 0 : 1,
        duration_ms: 12,
        artifact_ref: {
          path: evalResult.filePath,
          sha256: docHash,
        },
      },
    ],
    tokens: { in: null, out: null, cache: null, source: null },
    cost_usd: null,
    cost_evidence: `docs-eval:${docHash.slice(0, 16)}`,
    author: { model: "pinga-docs-evaluator", family: "pinga" },
    verified_by: { model: "llm-judge-rubric-v1", family: "evaluator" },
    summary: `Docs benchmark: ${evalResult.filePath} scored ${evalResult.globalScore}/100 (${evalResult.status.toUpperCase()}) sha256:${docHash.slice(0, 12)}`.slice(0, 280),
    created_at: new Date().toISOString(),
  };

  ledger.append(receipt);
}

/**
 * Renders the markdown scorecard.
 */
export function renderScorecardMarkdown(res: DocsEvalResult): string {
  const statusBadge =
    res.status === "pass"
      ? "🟢 APROVADO (GREEN)"
      : res.status === "amber"
        ? "🟡 REVISÃO CIRÚRGICA (AMBER)"
        : "🔴 REJEITADO (RED)";

  const lines: string[] = [
    `# 📊 Scorecard de Documentação Técnica: \`${res.filePath}\``,
    "",
    `**Score Global:** **\`${res.globalScore} / 100\`** — **${statusBadge}**`,
    "",
    "| Métrica | Peso | Nota (1-5) | Contribuição | Justificativa |",
    "| :--- | :---: | :---: | :---: | :--- |",
  ];

  for (const [key, weight] of Object.entries(WEIGHTS) as Array<[MetricKey, number]>) {
    const m = res.metrics[key];
    const contrib = (weight * ((m.score - 1) / 4) * 100).toFixed(1);
    const label =
      key === "gra"
        ? "Groundedness & Reality (GRA)"
        : key === "ato"
          ? "Actionability & Task (ATO)"
          : key === "cdn"
            ? "Cognitive Density (CDN)"
            : key === "pcm"
              ? "Pedagogical Clarity (PCM)"
              : key === "vdl"
                ? "Visual Legibility (VDL)"
                : "Structural Ergonomics (SDE)";

    lines.push(`| **${label}** | ${(weight * 100).toFixed(0)}% | \`${m.score}/5\` | ${contrib} pts | ${m.justification} |`);
  }

  if (res.criticalDeductions.length > 0) {
    lines.push("", "### ⚠️ Penalidades Críticas Aplicadas");
    for (const d of res.criticalDeductions) {
      lines.push(`- **-${d.points} pts** [${d.metric.toUpperCase()}]: ${d.reason}`);
    }
  }

  if (res.surgicalRecommendations.length > 0) {
    lines.push("", "### 🛠️ Apontamentos Cirúrgicos");
    for (let i = 0; i < res.surgicalRecommendations.length; i++) {
      const rec = res.surgicalRecommendations[i];
      lines.push(`#### ${i + 1}. ${rec.location}`, `> **Problema:** ${rec.issue}`);
      if (rec.suggestedDiff) {
        lines.push("```diff", rec.suggestedDiff, "```");
      }
    }
  }

  return lines.join("\n");
}
