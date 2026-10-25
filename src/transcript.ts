import { basename } from "node:path";
import { clip } from "./redact";

// Comandos que contam como verificação num transcript do Claude Code.
// Sem a flag `g`: `.test()` tem que ser stateless.
export const TEST_CMD_RE: RegExp =
  /\b(?:bun\s+test\b|go\s+test\b|mvn\s[^;|&]*\btest\b|surefire:test\b|mise\s+exec\s+--\s+lefthook\s+run\b|pinga(?:-stable)?\s+verify\b)/;

export const EDIT_TOOLS: readonly string[] = [
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
];

export type TranscriptSummary = {
  session_id: string | null;
  cwd: string | null;
  started_at: string | null;
  ended_at: string | null;
  model: string | null;
  verification: "pass" | "fail" | "none" | "not run";
  verification_evidence: string | null;
  rework_cycles: number;
  commits: number;
  excerpt_source: string | null;
};

type ToolUse = {
  name: string;
  command: string | null;
  line: number;
  isError: boolean | null; // null = sem tool_result
  result: string | null;
};

type Kind = "test" | "commit" | "edit" | "other";

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (
        item !== null &&
        typeof item === "object" &&
        (item as Record<string, unknown>).type === "text" &&
        typeof (item as Record<string, unknown>).text === "string"
      ) {
        parts.push((item as Record<string, unknown>).text as string);
      }
    }
    return parts.join("\n");
  }
  return "";
}

function userText(content: unknown): string | null {
  const joined = contentText(content);
  return joined === "" ? null : joined;
}

function classify(tu: ToolUse): Kind {
  if (tu.name === "Bash" && tu.command !== null) {
    if (TEST_CMD_RE.test(tu.command)) return "test";
    if (tu.command.includes("git commit")) return "commit";
  }
  if (EDIT_TOOLS.includes(tu.name)) return "edit";
  return "other";
}

/**
 * Parser puro de um transcript JSONL do Claude Code (item 6 do RED T14).
 * Linhas malformadas são puladas; nada aqui toca no sistema de arquivos.
 */
export function parseClaudeTranscript(text: string): TranscriptSummary {
  let sessionId: string | null = null;
  let cwd: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let model: string | null = null;
  let firstUserText: string | null = null;
  const uses: ToolUse[] = [];
  const byId = new Map<string, ToolUse>();

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (raw === "") continue;
    let obj: any;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (obj === null || typeof obj !== "object") continue;

    if (sessionId === null && typeof obj.sessionId === "string" && obj.sessionId !== "") {
      sessionId = obj.sessionId;
    }
    if (cwd === null && typeof obj.cwd === "string" && obj.cwd !== "") {
      cwd = obj.cwd;
    }
    if (typeof obj.timestamp === "string" && obj.timestamp !== "") {
      if (startedAt === null || obj.timestamp < startedAt) startedAt = obj.timestamp;
      if (endedAt === null || obj.timestamp > endedAt) endedAt = obj.timestamp;
    }

    const message: unknown =
      typeof obj.message === "object" && obj.message !== null ? obj.message : null;

    if (obj.type === "assistant" && message !== null) {
      const m = message as Record<string, unknown>;
      if (
        typeof m.model === "string" &&
        m.model !== "" &&
        m.model !== "<synthetic>"
      ) {
        model = m.model;
      }
    }

    if (message !== null && Array.isArray((message as Record<string, unknown>).content)) {
      const content = (message as Record<string, unknown>).content as unknown[];
      for (const item of content) {
        if (item === null || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        if (it.type === "tool_use" && typeof it.id === "string" && it.id !== "") {
          const input =
            typeof it.input === "object" && it.input !== null
              ? (it.input as Record<string, unknown>)
              : {};
          const tu: ToolUse = {
            name: typeof it.name === "string" ? it.name : "",
            command: typeof input.command === "string" ? input.command : null,
            line: i + 1,
            isError: null,
            result: null,
          };
          uses.push(tu);
          byId.set(it.id, tu);
        } else if (it.type === "tool_result" && typeof it.tool_use_id === "string") {
          const tu = byId.get(it.tool_use_id);
          if (tu === undefined || tu.isError !== null) continue;
          tu.isError = it.is_error === true;
          tu.result = contentText(it.content);
        }
      }
    }

    if (firstUserText === null && obj.type === "user" && message !== null) {
      const t = userText((message as Record<string, unknown>).content);
      if (t !== null) firstUserText = t;
    }
  }

  const kinds = uses.map(classify);

  // rework_cycles: resultado de teste fail seguido de pelo menos um tool_use
  // de edição antes do próximo comando de teste.
  let reworkCycles = 0;
  let pendingFail = false;
  let counted = false;
  for (let i = 0; i < uses.length; i++) {
    const kind = kinds[i]!;
    if (kind === "test") {
      pendingFail = uses[i]!.isError === true;
      counted = false;
    } else if (kind === "edit" && pendingFail && !counted) {
      reworkCycles++;
      counted = true;
    }
  }

  // commits: Bash "git commit" cujo resultado não é erro.
  let commits = 0;
  for (let i = 0; i < uses.length; i++) {
    if (kinds[i] === "commit" && uses[i]!.isError === false) commits++;
  }

  // verification: resultado do ÚLTIMO comando de teste; nenhum → "none".
  let verification: TranscriptSummary["verification"] = "none";
  let evidence: string | null = null;
  let lastTest = -1;
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === "test") lastTest = i;
  }
  if (lastTest !== -1) {
    const tu = uses[lastTest]!;
    const outcome =
      tu.isError === null ? "not run" : tu.isError ? "fail" : "pass";
    verification = outcome;
    evidence = `${outcome} · ${clip(tu.command ?? "", 120)} · linha ${tu.line}`;
  }

  // excerpt_source: 1º resultado de teste fail; senão comando do 1º
  // git commit; senão 1º texto do usuário; senão null.
  let excerptSource: string | null = null;
  for (let i = 0; i < uses.length; i++) {
    if (kinds[i] === "test" && uses[i]!.isError === true) {
      excerptSource = uses[i]!.result;
      break;
    }
  }
  if (excerptSource === null) {
    for (let i = 0; i < uses.length; i++) {
      if (kinds[i] === "commit") {
        excerptSource = uses[i]!.command;
        break;
      }
    }
  }
  if (excerptSource === null) excerptSource = firstUserText;

  return {
    session_id: sessionId,
    cwd,
    started_at: startedAt,
    ended_at: endedAt,
    model,
    verification,
    verification_evidence: evidence,
    rework_cycles: reworkCycles,
    commits,
    excerpt_source: excerptSource,
  };
}

/**
 * `.../<r>/.worktrees/<w>[/...]` → `<r>@<w>`; senão basename(cwd);
 * null → null.
 */
export function repoFromCwd(cwd: string | null): string | null {
  if (cwd === null) return null;
  const m = cwd.match(/\/([^/]+)\/\.worktrees\/([^/]+)(?:\/.*)?$/);
  if (m !== null) return `${m[1]}@${m[2]}`;
  return basename(cwd);
}
