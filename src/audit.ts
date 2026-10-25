import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { detect } from "./detect";

export type NoVerifyAuditResult = {
  tool_calls_flagged: number;
  git_commits_bypassed: number;
  clean_ratio: number;
};

export type LessonPrecisionResult = {
  sample_size: number;
  useful_count: number;
  precision_ratio: number;
  passes_gate: boolean;
  gate_threshold: number;
  details: Array<{
    id: string;
    pattern: string;
    is_useful: boolean;
    reason: string;
  }>;
};

export function computeAuditGate(input: {
  sample_size: number;
  useful_count: number;
  threshold?: number;
}): boolean {
  const threshold = input.threshold ?? 0.7;
  if (input.sample_size <= 0) return false;
  return input.useful_count / input.sample_size >= threshold;
}

function extractCommitMessage(cmd: string): string | null {
  const match = cmd.match(
    /(?:-m|--message)(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s·]+))/
  );
  if (match) {
    return match[1] ?? match[2] ?? match[3] ?? null;
  }
  const matchNoSpace = cmd.match(/-m(?:"([^"]+)"|'([^']+)'|([^\s·]+))/);
  if (matchNoSpace) {
    return matchNoSpace[1] ?? matchNoSpace[2] ?? matchNoSpace[3] ?? null;
  }
  return null;
}

function getGitCommitInfo(repoPath: string): {
  hashes: Set<string>;
  subjects: Set<string>;
  commits: Array<{ hash: string; subject: string }>;
} {
  try {
    const res = Bun.spawnSync(["git", "log", "--format=%H %s"], {
      cwd: repoPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (res.exitCode !== 0) {
      return { hashes: new Set(), subjects: new Set(), commits: [] };
    }
    const lines = res.stdout
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const hashes = new Set<string>();
    const subjects = new Set<string>();
    const commits: Array<{ hash: string; subject: string }> = [];
    for (const line of lines) {
      const spaceIdx = line.indexOf(" ");
      if (spaceIdx === -1) {
        hashes.add(line);
        hashes.add(line.slice(0, 7));
        commits.push({ hash: line, subject: "" });
      } else {
        const hash = line.slice(0, spaceIdx);
        const subj = line.slice(spaceIdx + 1).trim();
        hashes.add(hash);
        hashes.add(hash.slice(0, 7));
        if (subj.length > 0) subjects.add(subj);
        commits.push({ hash, subject: subj });
      }
    }
    return { hashes, subjects, commits };
  } catch {
    return { hashes: new Set(), subjects: new Set(), commits: [] };
  }
}

export async function auditNoVerify(
  db: Database,
  repoPath?: string
): Promise<NoVerifyAuditResult> {
  const tableExists = db
    .query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session'")
    .get();
  if (!tableExists) {
    return {
      tool_calls_flagged: 0,
      git_commits_bypassed: 0,
      clean_ratio: 1,
    };
  }

  const rows = db
    .query(
      "SELECT verification_evidence FROM session WHERE verification_evidence IS NOT NULL"
    )
    .all() as Array<{ verification_evidence: string }>;

  let toolCallsFlagged = 0;
  const flaggedCommands: string[] = [];

  for (const row of rows) {
    const evidence = row.verification_evidence;
    if (!evidence) continue;
    const lines = evidence.split("\n");
    for (const line of lines) {
      if (line.includes("--no-verify")) {
        toolCallsFlagged++;
        flaggedCommands.push(line);
      }
    }
  }

  let gitCommitsBypassed = 0;
  if (repoPath && existsSync(repoPath) && flaggedCommands.length > 0) {
    const gitInfo = getGitCommitInfo(repoPath);
    const flaggedMessages = new Set<string>();
    for (const cmd of flaggedCommands) {
      const msg = extractCommitMessage(cmd);
      if (msg) flaggedMessages.add(msg);
    }

    for (const commit of gitInfo.commits) {
      const matchedBySubject =
        commit.subject.length > 0 && flaggedMessages.has(commit.subject);
      const matchedByHash =
        gitInfo.hashes.has(commit.hash) &&
        flaggedCommands.some(
          (cmd) =>
            cmd.includes(commit.hash) ||
            cmd.includes(commit.hash.slice(0, 7)) ||
            (commit.subject.length > 0 && cmd.includes(commit.subject))
        );
      if (matchedBySubject || matchedByHash) {
        gitCommitsBypassed++;
      }
    }
  }

  const cleanRatio =
    toolCallsFlagged === 0
      ? 1
      : Number(
          Math.max(
            0,
            1 - gitCommitsBypassed / toolCallsFlagged
          ).toFixed(3)
        );

  return {
    tool_calls_flagged: toolCallsFlagged,
    git_commits_bypassed: gitCommitsBypassed,
    clean_ratio: cleanRatio,
  };
}

export function evaluateLessonsPrecision(
  db: Database,
  opts?: { sampleSize?: number; threshold?: number }
): LessonPrecisionResult {
  const sampleSizeTarget = opts?.sampleSize ?? 30;
  const threshold = opts?.threshold ?? 0.7;

  const { candidates } = detect(db);

  const sorted = [...candidates].sort((a, b) => {
    const ha = createHash("sha256").update(a.id).digest("hex");
    const hb = createHash("sha256").update(b.id).digest("hex");
    if (ha !== hb) return ha < hb ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  const sample = sorted.slice(0, sampleSizeTarget);
  const sampleSize = sample.length;

  if (sampleSize === 0) {
    return {
      sample_size: 0,
      useful_count: 0,
      precision_ratio: 0,
      passes_gate: false,
      gate_threshold: threshold,
      details: [],
    };
  }

  const details = sample.map((c) => {
    const hasAction =
      typeof c.action === "string" && c.action.trim().length > 0;
    const hasRepo = typeof c.repo === "string" && c.repo.trim().length > 0;
    const hasSession =
      typeof c.session_id === "string" && c.session_id.trim().length > 0;

    let isUseful = false;
    let reason = "";

    if (!hasAction) {
      reason = "sem ação acionável";
    } else if (!hasRepo) {
      reason = "sem repo concreto";
    } else if (!hasSession) {
      reason = "sem evidência com sessão válida";
    } else {
      isUseful = true;
      reason = "regra acionável com evidência multi-sessão e repo concreto";
    }

    return {
      id: c.id,
      pattern: c.detector,
      is_useful: isUseful,
      reason,
    };
  });

  const usefulCount = details.filter((d) => d.is_useful).length;
  const precisionRatio = Number((usefulCount / sampleSize).toFixed(3));
  const passesGate = computeAuditGate({
    sample_size: sampleSize,
    useful_count: usefulCount,
    threshold,
  });

  return {
    sample_size: sampleSize,
    useful_count: usefulCount,
    precision_ratio: precisionRatio,
    passes_gate: passesGate,
    gate_threshold: threshold,
    details,
  };
}
