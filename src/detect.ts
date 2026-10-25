import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { redactExcerpt } from "./redact";

export const DETECTORS = [
  "rework",
  "missing_verification",
  "breaker_tripped",
  "overfit_holdout",
  "guard_violation",
] as const;

export type Detector = (typeof DETECTORS)[number];

export const ALL_DETECTORS = [...DETECTORS, "user_correction"] as const;

export type ExtendedDetector = (typeof ALL_DETECTORS)[number];

export const CORRECTION_MARKERS_PT_EN =
  /\b(não|nao|errado|pare|reverte|desfaça|desfaca|volta|corrija|em vez disso|no|wrong|stop|revert|undo|don't|dont|instead|incorrect)\b/i;

export type LessonClass = "bom" | "ruim" | "simplificar" | "melhorar";

export const REWORK_MIN = 3;

export type Candidate = {
  id: string; // "L-" + sha256(detector + "\n" + session_id).slice(0, 12)
  detector: ExtendedDetector;
  class: LessonClass;
  session_id: string;
  harness: string;
  repo: string | null;
  task: string | null;
  model: string | null;
  model_family: string | null;
  metric: string;
  value: number;
  baseline: string;
  excerpt: string; // 1..300 chars, redigido de novo (redactExcerpt)
  action: string;
  destination: string;
};

const LESSON_CLASSES: ReadonlyArray<LessonClass> = [
  "bom",
  "ruim",
  "simplificar",
  "melhorar",
];

const CANDIDATE_KEYS: ReadonlyArray<keyof Candidate> = [
  "id",
  "detector",
  "class",
  "session_id",
  "harness",
  "repo",
  "task",
  "model",
  "model_family",
  "metric",
  "value",
  "baseline",
  "excerpt",
  "action",
  "destination",
];

const NON_EMPTY_KEYS = [
  "session_id",
  "harness",
  "metric",
  "baseline",
  "action",
  "destination",
] as const;

const NULLABLE_STRING_KEYS = ["repo", "task", "model", "model_family"] as const;

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Id estável: L- + primeiros 12 hex de sha256(detector + "\n" + session_id). */
export function candidateId(
  detector: ExtendedDetector | Detector | string,
  sessionId: string,
): string {
  return `L-${sha256hex(`${detector}\n${sessionId}`).slice(0, 12)}`;
}

/**
 * Valida um objeto plano contra o tipo `Candidate`: exatamente as 15 chaves,
 * campos de texto não vazios, excerpt de 1..300, value inteiro >= 0 e id
 * consistente com candidateId(detector, session_id).
 */
export function validateCandidate(
  x: unknown,
): { ok: true; candidate: Candidate } | { ok: false; errors: string[] } {
  if (typeof x !== "object" || x === null || Array.isArray(x)) {
    return { ok: false, errors: ["candidato não é um objeto plano"] };
  }
  const o = x as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(o)) {
    if (!CANDIDATE_KEYS.includes(key as keyof Candidate)) {
      errors.push(`chave desconhecida: ${key}`);
    }
  }
  for (const key of CANDIDATE_KEYS) {
    if (!(key in o)) errors.push(`chave ausente: ${key}`);
  }

  const nonEmpty = (key: keyof Candidate): boolean =>
    typeof o[key] === "string" && (o[key] as string).trim().length > 0;

  for (const key of NON_EMPTY_KEYS) {
    if (!nonEmpty(key)) errors.push(`${key} deve ser string não vazia`);
  }

  if (
    typeof o.excerpt !== "string" ||
    o.excerpt.length < 1 ||
    o.excerpt.length > 300
  ) {
    errors.push("excerpt deve ter entre 1 e 300 chars");
  }

  if (typeof o.value !== "number" || !Number.isInteger(o.value) || o.value < 0) {
    errors.push("value deve ser inteiro >= 0");
  }

  for (const key of NULLABLE_STRING_KEYS) {
    const v = o[key];
    if (v !== null && typeof v !== "string") {
      errors.push(`${key} deve ser string ou null`);
    }
  }

  const detectorOk =
    typeof o.detector === "string" &&
    (ALL_DETECTORS as readonly string[]).includes(o.detector);
  if (!detectorOk) errors.push("detector deve ser um de ALL_DETECTORS");

  if (
    typeof o.class !== "string" ||
    !(LESSON_CLASSES as readonly string[]).includes(o.class)
  ) {
    errors.push("class deve ser bom | ruim | simplificar | melhorar");
  }

  if (typeof o.id !== "string" || !/^L-[0-9a-f]{12}$/.test(o.id)) {
    errors.push("id deve casar com ^L-[0-9a-f]{12}$");
  } else if (detectorOk && nonEmpty("session_id")) {
    const expected = candidateId(
      o.detector as ExtendedDetector,
      o.session_id as string,
    );
    if (o.id !== expected) {
      errors.push("id deve ser candidateId(detector, session_id)");
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, candidate: o as unknown as Candidate };
}

/** Ação editorial fixa por detector (constante no código, <= 280 chars). */
const ACTIONS: Record<ExtendedDetector, string> = {
  rework:
    "Divida o passo em subpassos verificáveis e revise o contrato RED antes de editar em loop; muitos ciclos de retrabalho indicam objetivo mal formulado",
  missing_verification:
    "Nenhum commit sem verificação executada: rode a suíte completa e prove o resultado antes de cada commit",
  breaker_tripped:
    "Com o disjuntor armado, troque de abordagem em vez de repetir o comando: reavalie o contrato, refaça a base RED ou peça revisão humana",
  overfit_holdout:
    "Valide contra casos novos além do holdout reproduzido: acerto repetido sem evidência nova indica memorização; revise a abordagem",
  guard_violation:
    "Respeite o touch e os tests_frozen do plano: ajuste o plano e registre a mudança de escopo antes de editar fora do combinado",
  user_correction:
    "Interrompa a abordagem ao receber correção do usuário: reverta a edição incorreta e releia o contrato antes de tentar novamente",
};

type DetectRow = {
  id: string;
  harness: string;
  repo: string | null;
  task: string | null;
  started_at: string | null;
  model: string | null;
  model_family: string | null;
  verification: string | null;
  reason_code: string | null;
  rework_cycles: number | null;
  commits: number | null;
  excerpt: string | null;
};

const SELECT_COLS =
  "id, harness, repo, task, started_at, model, model_family, verification, reason_code, rework_cycles, commits, excerpt";

/** `<repo sem "@…">/LESSONS.md`, ou a raiz quando repo é nulo (CLAUDE.md do workspace). */
function destinationFor(repo: string | null): string {
  return repo ? `${repo.split("@")[0]}/LESSONS.md` : "LESSONS.md (raiz)";
}

/**
 * Detectores determinísticos (D20): SQL puro sobre a tabela `session`, sem
 * LLM e sem relógio. Mesmo banco → mesmos candidatos, na ordem de DETECTORS
 * e depois de session_id. Candidato com excerpt não redigível (null) ou que
 * falha no validateCandidate é descartado (discarded++).
 */
export function detect(db: Database): {
  candidates: Candidate[];
  discarded: number;
} {
  let discarded = 0;
  const raw: Candidate[] = [];

  const select = (
    where: string,
    params: Array<string | number> = [],
  ): DetectRow[] =>
    db
      .query(`SELECT ${SELECT_COLS} FROM session WHERE ${where}`)
      .all(...params) as unknown as DetectRow[];

  const pushCandidate = (
    detector: Detector,
    cls: LessonClass,
    metric: string,
    value: number,
    baseline: string,
    row: DetectRow,
  ): void => {
    const excerpt = redactExcerpt(row.excerpt);
    if (excerpt === null) {
      discarded++;
      return;
    }
    const candidate: Candidate = {
      id: candidateId(detector, row.id),
      detector,
      class: cls,
      session_id: row.id,
      harness: row.harness,
      repo: row.repo,
      task: row.task,
      model: row.model,
      model_family: row.model_family,
      metric,
      value,
      baseline,
      excerpt,
      action: ACTIONS[detector],
      destination: destinationFor(row.repo),
    };
    const checked = validateCandidate(candidate);
    if (!checked.ok) {
      discarded++;
      return;
    }
    raw.push(checked.candidate);
  };

  // 1. rework — transcripts com rework_cycles >= REWORK_MIN (um por linha).
  for (const row of select(
    "kind = 'transcript' AND rework_cycles >= ?",
    [REWORK_MIN],
  )) {
    pushCandidate(
      "rework",
      "ruim",
      "rework_cycles",
      row.rework_cycles ?? 0,
      ">= 3",
      row,
    );
  }

  // 2. missing_verification — commits sem verificação (um por linha).
  for (const row of select(
    "kind = 'transcript' AND commits >= 1 AND verification = 'none'",
  )) {
    pushCandidate(
      "missing_verification",
      "ruim",
      "commits_without_test",
      row.commits ?? 0,
      "0",
      row,
    );
  }

  // 3-5. Recibos: um candidato por grupo (detector, task); task nula → grupo
  // da própria linha. Representante = menor (started_at, id), dele vêm
  // session_id, excerpt, model, model_family, harness e repo.
  const grouped = (
    detector: "breaker_tripped" | "overfit_holdout" | "guard_violation",
    where: string,
    cls: LessonClass,
    metric: string,
  ): void => {
    const groups = new Map<string, DetectRow[]>();
    for (const row of select(where)) {
      const key = row.task !== null ? `task:${row.task}` : `own:${row.id}`;
      const group = groups.get(key);
      if (group === undefined) groups.set(key, [row]);
      else group.push(row);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => {
        const sa = a.started_at ?? "";
        const sb = b.started_at ?? "";
        if (sa !== sb) return sa < sb ? -1 : 1;
        if (a.id !== b.id) return a.id < b.id ? -1 : 1;
        return 0;
      });
      pushCandidate(detector, cls, metric, group.length, "0", group[0]!);
    }
  };

  grouped(
    "breaker_tripped",
    "kind = 'receipt' AND reason_code = 'breaker_same_failure'",
    "melhorar",
    "breaker_trips",
  );
  grouped(
    "overfit_holdout",
    "kind = 'receipt' AND reason_code = 'overfit_holdout'",
    "ruim",
    "overfit_holdout",
  );
  grouped(
    "guard_violation",
    "kind = 'receipt' AND reason_code IN ('tests_frozen_changed', 'scope_drift')",
    "ruim",
    "guard_violations",
  );

  // Ordem canônica: índice do detector em DETECTORS, depois session_id.
  raw.sort((a, b) => {
    const ia = DETECTORS.indexOf(a.detector as (typeof DETECTORS)[number]);
    const ib = DETECTORS.indexOf(b.detector as (typeof DETECTORS)[number]);
    if (ia !== ib) return ia - ib;
    if (a.session_id !== b.session_id) {
      return a.session_id < b.session_id ? -1 : 1;
    }
    return 0;
  });

  return { candidates: raw, discarded };
}

export function isHumanCorrectionPrompt(turn: {
  text: string;
  is_sidechain?: boolean | number;
  is_subagent?: boolean | number;
  preceding_tool_failed?: boolean;
}): boolean {
  if (!turn || typeof turn !== "object") return false;
  if (
    turn.is_sidechain === true ||
    turn.is_sidechain === 1 ||
    turn.is_subagent === true ||
    (turn as Record<string, unknown>).is_subagent === 1
  ) {
    return false;
  }
  if (typeof turn.text !== "string") return false;
  const trimmed = turn.text.trim();
  if (trimmed.length === 0 || trimmed.length > 400) return false;
  if (/^(\s*<TASK>|\s*<SYSTEM_MESSAGE>|\s*\[Message\])/i.test(trimmed)) {
    return false;
  }
  if (turn.preceding_tool_failed !== true) return false;
  return CORRECTION_MARKERS_PT_EN.test(trimmed);
}

export function detectUserCorrection(
  db: Database,
): Array<Candidate> {
  const tables = new Set(
    (
      db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name),
  );
  if (!tables.has("user_turns")) return [];

  const rows = db
    .query(
      `SELECT id, session_id, text FROM user_turns
       WHERE is_human = 1 AND has_correction_marker = 1 AND preceding_tool_failed = 1
       ORDER BY id ASC`,
    )
    .all() as Array<{ id: number; session_id: string; text: string }>;

  if (rows.length === 0) return [];

  const groups = new Map<string, { count: number; firstExcerpt: string }>();
  for (const row of rows) {
    const existing = groups.get(row.session_id);
    if (!existing) {
      groups.set(row.session_id, { count: 1, firstExcerpt: row.text });
    } else {
      existing.count++;
    }
  }

  const out: Candidate[] = [];
  const sessionIds = Array.from(groups.keys()).sort();

  for (const sessionId of sessionIds) {
    const group = groups.get(sessionId)!;
    const excerpt = redactExcerpt(group.firstExcerpt);
    if (excerpt === null) continue;

    let harness = sessionId.includes(":") ? sessionId.split(":")[0]! : "unknown";
    let repo: string | null = null;
    let task: string | null = null;
    let model: string | null = null;
    let model_family: string | null = null;

    if (tables.has("session")) {
      const sess = db
        .query(
          "SELECT harness, repo, task, model, model_family FROM session WHERE id = ?",
        )
        .get(sessionId) as {
        harness: string;
        repo: string | null;
        task: string | null;
        model: string | null;
        model_family: string | null;
      } | null;
      if (sess) {
        if (sess.harness) harness = sess.harness;
        repo = sess.repo;
        task = sess.task;
        model = sess.model;
        model_family = sess.model_family;
      }
    }

    const candidate: Candidate = {
      id: candidateId("user_correction", sessionId),
      detector: "user_correction",
      class: "ruim",
      session_id: sessionId,
      harness,
      repo,
      task,
      model,
      model_family,
      metric: "user_corrections",
      value: group.count,
      baseline: "0",
      excerpt,
      action: ACTIONS["user_correction"],
      destination: destinationFor(repo),
    };

    const checked = validateCandidate(candidate);
    if (checked.ok) {
      out.push(checked.candidate);
    }
  }

  return out;
}

export function detectAll(db: Database): {
  candidates: Array<Candidate>;
  discarded: number;
} {
  const base = detect(db);
  const corr = detectUserCorrection(db);
  const allCandidates = [...base.candidates, ...corr];

  allCandidates.sort((a, b) => {
    const ia = ALL_DETECTORS.indexOf(a.detector);
    const ib = ALL_DETECTORS.indexOf(b.detector);
    if (ia !== ib) return ia - ib;
    if (a.session_id !== b.session_id) {
      return a.session_id < b.session_id ? -1 : 1;
    }
    return 0;
  });

  return {
    candidates: allCandidates,
    discarded: base.discarded,
  };
}
