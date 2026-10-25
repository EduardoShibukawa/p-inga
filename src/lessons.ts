import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type Candidate, detect, validateCandidate } from "./detect";
import {
  attestFromEndpoint,
  modelFamily,
} from "./family";
import { assertDistinctFamily, parseVerdict } from "./judge";
import { defaultLearnDbPath, LEARN_EXIT, openLearnDb } from "./learn";
import { defaultStateDir, writeAtomic } from "./manifest";

export const PROPOSALS_HEADER = "# LESSONS-PROPOSED — pinga learn propose v1";

const PROPOSALS_COMMENT =
  "<!-- gerado por pinga (T15): não editar; promover com `pinga learn promote` -->";

const NO_CANDIDATE = "_nenhum candidato_";

export const LESSON_JUDGE_PROMPT_VERSION = 1;

const LESSON_JUDGE_SYSTEM_PROMPT = [
  `Você é o juiz de lições do p-inga (LESSON_JUDGE_PROMPT_VERSION=${LESSON_JUDGE_PROMPT_VERSION}).`,
  "Recebe um candidato a lição (JSON) com métrica, trecho redigido e ação proposta.",
  'Responda APENAS com um JSON no formato {"verdict": "pass" | "fail", "findings": string[]}.',
  "verdict fail exige achados concretos em findings. Não use cercas nem prosa extra.",
].join(" ");

export type Verdict = {
  verdict: "pass" | "fail";
  findings: string[];
  served: string;
  family: string;
};

export type ProposeOptions = {
  db?: string;
  out?: string;
  judgeModel?: string;
  judgeEndpoint?: string;
  env?: Record<string, string | undefined>;
};

export type PromoteOptions = {
  proposals: string;
  id: string;
  to: string;
  by?: string;
  env?: Record<string, string | undefined>;
};

/** <state>/pinga/LESSONS-PROPOSED.md */
export function defaultProposalsPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(defaultStateDir(env), "LESSONS-PROPOSED.md");
}

const DASH = "—";
const SEP = " · ";

function display(v: string | null): string {
  return v === null ? DASH : v;
}

function undisplay(v: string): string | null {
  return v === DASH ? null : v;
}

/** "não julgado" | "aprovada por <served> (<family>)" | "rejeitada por …: findings". */
function renderVerdictLine(verdict: Verdict | null): string {
  if (verdict === null) return "não julgado";
  const who = `por ${verdict.served} (${verdict.family})`;
  if (verdict.verdict === "pass") return `aprovada ${who}`;
  // findings unidos por "; " e cortados em 280 chars.
  return `rejeitada ${who}: ${verdict.findings.join("; ").slice(0, 280)}`;
}

function renderItem(item: {
  candidate: Candidate;
  verdict: Verdict | null;
}): string {
  const c = item.candidate;
  return [
    `## ${c.id}${SEP}${c.detector}${SEP}${c.class}`,
    `- sessão: ${c.session_id} (${c.harness}${SEP}repo ${display(c.repo)}${SEP}task ${display(c.task)})`,
    `- modelo: ${display(c.model)} (${display(c.model_family)})`,
    `- métrica: ${c.metric} = ${c.value} (baseline ${c.baseline})`,
    `- trecho: ${JSON.stringify(c.excerpt)}`,
    `- ação: ${c.action}`,
    `- destino: ${c.destination}`,
    `- juiz: ${renderVerdictLine(item.verdict)}`,
  ].join("\n");
}

/**
 * Bytes só função da entrada (sem data): cabeçalho, comentário, linha vazia e
 * os itens separados por linha vazia, com newline final. Lista vazia renderiza
 * `_nenhum candidato_`.
 */
export function renderProposals(
  items: Array<{ candidate: Candidate; verdict: Verdict | null }>,
): string {
  const lines: string[] = [PROPOSALS_HEADER, PROPOSALS_COMMENT, ""];
  if (items.length === 0) {
    lines.push(NO_CANDIDATE);
  } else {
    lines.push(items.map(renderItem).join("\n\n"));
  }
  return `${lines.join("\n")}\n`;
}

function parseVerdictLine(s: string): Verdict | null | undefined {
  if (s === "não julgado") return null;
  const pass = s.match(/^aprovada por (.+) \((.*)\)$/);
  if (pass !== null) {
    return {
      verdict: "pass",
      findings: [],
      served: pass[1]!,
      family: pass[2]!,
    };
  }
  const fail = s.match(/^rejeitada por (.+?) \((.*)\): (.*)$/);
  if (fail !== null) {
    const joined = fail[3]!;
    return {
      verdict: "fail",
      findings: joined === "" ? [] : joined.split("; "),
      served: fail[1]!,
      family: fail[2]!,
    };
  }
  return undefined;
}

const SESSAO_PREFIX = "- sessão: ";
const MODELO_PREFIX = "- modelo: ";
const METRICA_PREFIX = "- métrica: ";
const TRECHO_PREFIX = "- trecho: ";
const ACAO_PREFIX = "- ação: ";
const DESTINO_PREFIX = "- destino: ";
const JUIZ_PREFIX = "- juiz: ";

function parseItemBlock(
  block: string[],
): { candidate: Candidate; verdict: Verdict | null } | string {
  if (block.length !== 8) {
    return `item deve ter 8 linhas (tem ${block.length})`;
  }

  const head = block[0]!;
  if (!head.startsWith("## ")) return "cabeçalho de item inválido";
  const headParts = head.slice(3).split(SEP);
  if (headParts.length !== 3) return "cabeçalho de item inválido";
  const [id, detector, cls] = headParts as [string, string, string];

  const lineSess = block[1]!;
  if (!lineSess.startsWith(SESSAO_PREFIX)) return "linha 'sessão' ausente";
  const mSess = lineSess
    .slice(SESSAO_PREFIX.length)
    .match(/^(.+?) \((.+?) · repo (.*) · task (.*)\)$/);
  if (mSess === null) return "linha 'sessão' inválida";
  const session_id = mSess[1]!;
  const harness = mSess[2]!;

  const lineModelo = block[2]!;
  if (!lineModelo.startsWith(MODELO_PREFIX)) return "linha 'modelo' ausente";
  const mModelo = lineModelo
    .slice(MODELO_PREFIX.length)
    .match(/^(.+?) \((.*)\)$/);
  if (mModelo === null) return "linha 'modelo' inválida";
  const model = undisplay(mModelo[1]!);
  const model_family = undisplay(mModelo[2]!);

  const lineMetrica = block[3]!;
  if (!lineMetrica.startsWith(METRICA_PREFIX)) return "linha 'métrica' ausente";
  const mMetrica = lineMetrica
    .slice(METRICA_PREFIX.length)
    .match(/^(.+?) = (\d+) \(baseline (.*)\)$/);
  if (mMetrica === null) return "linha 'métrica' inválida";
  const metric = mMetrica[1]!;
  const value = Number(mMetrica[2]);
  const baseline = mMetrica[3]!;

  const lineTrecho = block[4]!;
  if (!lineTrecho.startsWith(TRECHO_PREFIX)) return "linha 'trecho' ausente";
  let excerpt: unknown;
  try {
    excerpt = JSON.parse(lineTrecho.slice(TRECHO_PREFIX.length));
  } catch {
    return "linha 'trecho' inválida (JSON)";
  }
  if (typeof excerpt !== "string") {
    return "linha 'trecho' inválida (não é string)";
  }

  const lineAcao = block[5]!;
  if (!lineAcao.startsWith(ACAO_PREFIX)) return "linha 'ação' ausente";
  const action = lineAcao.slice(ACAO_PREFIX.length);

  const lineDestino = block[6]!;
  if (!lineDestino.startsWith(DESTINO_PREFIX)) return "linha 'destino' ausente";
  const destination = lineDestino.slice(DESTINO_PREFIX.length);

  const lineJuiz = block[7]!;
  if (!lineJuiz.startsWith(JUIZ_PREFIX)) return "linha 'juiz' ausente";
  const verdict = parseVerdictLine(lineJuiz.slice(JUIZ_PREFIX.length));
  if (verdict === undefined) return "linha 'juiz' inválida";

  const candidate = {
    id,
    detector,
    class: cls,
    session_id,
    harness,
    repo: undisplay(mSess[3]!),
    task: undisplay(mSess[4]!),
    model,
    model_family,
    metric,
    value,
    baseline,
    excerpt,
    action,
    destination,
  };
  const checked = validateCandidate(candidate);
  if (!checked.ok) {
    return `candidato inválido: ${checked.errors.join("; ")}`;
  }
  return { candidate: checked.candidate, verdict };
}

/** Round-trip exato de renderProposals: mesmos items, incluindo vereditos. */
export function parseProposals(text: string):
  | { ok: true; items: Array<{ candidate: Candidate; verdict: Verdict | null }> }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split("\n");
  if (lines[0] !== PROPOSALS_HEADER) {
    errors.push("cabeçalho ausente ou inválido");
  }
  if (lines[1] !== PROPOSALS_COMMENT) {
    errors.push("comentário de geração ausente");
  }
  if (errors.length > 0) return { ok: false, errors };
  if (lines[2] !== "") {
    return { ok: false, errors: ["linha vazia ausente após o comentário"] };
  }

  const body = lines.slice(3);
  if (body[body.length - 1] !== "") {
    return { ok: false, errors: ["arquivo deve terminar com newline"] };
  }
  body.pop();

  if (body.length === 1 && body[0] === NO_CANDIDATE) {
    return { ok: true, items: [] };
  }
  if (body.length === 0) {
    return { ok: false, errors: ["nenhum candidato listado"] };
  }

  // Itens separados por linha vazia.
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of body) {
    if (line === "") {
      blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);

  const items: Array<{ candidate: Candidate; verdict: Verdict | null }> = [];
  for (const block of blocks) {
    const parsed = parseItemBlock(block);
    if (typeof parsed === "string") {
      errors.push(parsed);
    } else {
      items.push(parsed);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, items };
}

/**
 * `pinga learn propose`: detecta candidatos no learn.db, opcionalmente julga
 * cada um por um endpoint atestado e escreve LESSONS-PROPOSED.md (atômico).
 * O juiz só é ligado por flag; abortos I10 (exit 7/8) não escrevem arquivo
 * nem chamam o chat. O juiz só anota — fail não remove o candidato (I20).
 */
export async function proposeCmd(opts: ProposeOptions): Promise<number> {
  const env = opts.env ?? process.env;
  const dbPath = opts.db ?? defaultLearnDbPath(env);
  const outPath = opts.out ?? defaultProposalsPath(env);

  // Banco inexistente → exit 8 sem criar o banco nem o arquivo --out.
  if (!existsSync(dbPath)) {
    console.error(`learn propose: banco não encontrado: ${dbPath}`);
    return LEARN_EXIT.infra;
  }

  let detected: { candidates: Candidate[]; discarded: number };
  try {
    const db = openLearnDb(dbPath);
    try {
      detected = detect(db);
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`learn propose: banco ilegível: ${(err as Error).message}`);
    return LEARN_EXIT.infra;
  }
  const { candidates, discarded } = detected;
  const items: Array<{ candidate: Candidate; verdict: Verdict | null }> =
    candidates.map((candidate) => ({ candidate, verdict: null }));

  if (opts.judgeModel !== undefined || opts.judgeEndpoint !== undefined) {
    const endpoint =
      opts.judgeEndpoint ?? env.PINGA_JUDGE_ENDPOINT ?? "http://127.0.0.1:8089";
    const attest = await attestFromEndpoint(endpoint, opts.judgeModel ?? null);
    if (!attest.ok) {
      console.error(
        `learn propose: atestação do juiz falhou (${attest.reason_code}): ${attest.error}`,
      );
      return LEARN_EXIT.infra;
    }
    const served = attest.attested.served;
    const judgeFamily = modelFamily(served);

    // Pré-checagem I10 sobre TODOS os candidatos antes de qualquer chamada
    // ao chat: same_family_judge (exit 7) tem precedência sobre
    // model_unattested (exit 8). Nenhum arquivo é tocado.
    const sameFamily: string[] = [];
    const unattested: string[] = [];
    for (const item of items) {
      const dist = assertDistinctFamily(
        item.candidate.model_family,
        judgeFamily,
      );
      if (!dist.ok) {
        if (dist.reason_code === "same_family_judge") {
          sameFamily.push(item.candidate.id);
        } else {
          unattested.push(item.candidate.id);
        }
      }
    }
    if (sameFamily.length > 0) {
      console.error(`same_family_judge: ${sameFamily.join(", ")}`);
      return 7;
    }
    if (unattested.length > 0) {
      console.error(`model_unattested: ${unattested.join(", ")}`);
      return LEARN_EXIT.infra;
    }

    const timeoutMs = Number(env.PINGA_JUDGE_TIMEOUT_MS ?? 120000);
    for (const item of items) {
      try {
        const res = await fetch(
          `${endpoint.replace(/\/+$/, "")}/v1/chat/completions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: served,
              temperature: 0,
              messages: [
                { role: "system", content: LESSON_JUDGE_SYSTEM_PROMPT },
                { role: "user", content: JSON.stringify(item.candidate) },
              ],
            }),
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
        if (!res.ok) {
          console.error(`learn propose: juiz respondeu HTTP ${res.status}`);
          return LEARN_EXIT.infra;
        }
        const body = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = body.choices?.[0]?.message?.content ?? "";
        const verdict = parseVerdict(content);
        if (!verdict.ok) {
          console.error(
            `learn propose: veredito inválido do juiz: ${verdict.error}`,
          );
          return LEARN_EXIT.infra;
        }
        item.verdict = {
          verdict: verdict.verdict,
          findings: verdict.findings,
          served,
          family: judgeFamily,
        };
      } catch (err) {
        console.error(
          `learn propose: juiz indisponível: ${(err as Error).message}`,
        );
        return LEARN_EXIT.infra;
      }
    }
  }

  writeAtomic(outPath, renderProposals(items));
  console.log(`proposed ${items.length} discarded ${discarded} → ${outPath}`);
  return LEARN_EXIT.ok;
}

/**
 * `pinga learn promote`: ato humano e auditável. Recusa lição rejeitada pelo
 * juiz (exit 1) e destino já promovido (exit 1); id ausente ou propostas
 * inválidas → exit 2. Ao promover, acrescenta o bloco ao LESSONS.md (sem o
 * excerpt) e grava uma linha em <state>/pinga/promotions.jsonl.
 */
export function promoteCmd(opts: PromoteOptions): number {
  const env = opts.env ?? process.env;

  let text: string;
  try {
    text = readFileSync(opts.proposals, "utf8");
  } catch (err) {
    console.error(
      `learn promote: propostas ilegíveis: ${(err as Error).message}`,
    );
    return LEARN_EXIT.usage;
  }
  const parsed = parseProposals(text);
  if (!parsed.ok) {
    console.error(
      `learn promote: propostas inválidas: ${parsed.errors.join("; ")}`,
    );
    return LEARN_EXIT.usage;
  }
  const item = parsed.items.find((it) => it.candidate.id === opts.id);
  if (item === undefined) {
    console.error(
      `learn promote: id não encontrado em ${opts.proposals}: ${opts.id}`,
    );
    return LEARN_EXIT.usage;
  }

  const by = opts.by ?? env.USER ?? "";
  if (by.trim() === "") {
    console.error("learn promote: autor vazio (--by NOME ou USER no ambiente)");
    return LEARN_EXIT.usage;
  }

  if (item.verdict !== null && item.verdict.verdict === "fail") {
    console.error("rejeitada pelo juiz");
    return 1;
  }

  const toAbs = resolve(opts.to);
  const existing = existsSync(toAbs) ? readFileSync(toAbs, "utf8") : "";
  const marker = `pinga promote ${item.candidate.id}`;
  if (existing.includes(marker)) {
    console.error(`já promovida: ${marker}`);
    return 1;
  }

  const proposalSha = createHash("sha256").update(text).digest("hex");
  const at =
    env.PINGA_NOW !== undefined && env.PINGA_NOW !== ""
      ? env.PINGA_NOW
      : new Date().toISOString();
  const c = item.candidate;
  // O excerpt não vai para o LESSONS.md — só a ação, a métrica e a trilha.
  const block =
    `- ${c.action} (${c.detector}: ${c.metric} = ${c.value}, baseline ${c.baseline}; sessão ${c.session_id})\n` +
    `  <!-- ${marker} · proposta sha256:${proposalSha} · por ${by} · em ${at} -->\n`;
  const prefix =
    existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  writeAtomic(toAbs, prefix + block);

  const trailPath = join(defaultStateDir(env), "promotions.jsonl");
  mkdirSync(dirname(trailPath), { recursive: true });
  const trail = {
    id: c.id,
    proposal_sha256: proposalSha,
    to: toAbs,
    by,
    at,
    detector: c.detector,
    session_id: c.session_id,
  };
  appendFileSync(trailPath, `${JSON.stringify(trail)}\n`);

  return LEARN_EXIT.ok;
}
