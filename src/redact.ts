import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const REDACT_KINDS = [
  "anthropic",
  "github",
  "aws",
  "jwt",
  "private_key",
  "url_credentials",
  "denylist",
  "entropy",
] as const;

export type RedactKind = (typeof REDACT_KINDS)[number];

export const ENTROPY_MIN_BITS = 4.0;
export const ENTROPY_MIN_LEN = 24;
export const EXCERPT_MAX = 300;

function marker(kind: RedactKind): string {
  return `[REDACTED:${kind}]`;
}

// Camada 1 — um detector por formato de credencial. A ordem define o
// determinismo; nenhuma substituição do tipo A cria um casamento do tipo B.
const REGEX_LAYERS: ReadonlyArray<readonly [RedactKind, string]> = [
  ["anthropic", "sk-ant-[A-Za-z0-9_-]{20,}"],
  ["github", "gh[pousr]_[A-Za-z0-9]{36,}"],
  ["aws", "\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b"],
  ["jwt", "\\beyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"],
  [
    "private_key",
    "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----",
  ],
  [
    "url_credentials",
    "([a-z][a-z0-9+.-]*:\\/\\/)([^/\\s:@\\[\\]]+:[^/\\s@\\[\\]]+)@",
  ],
];

// Camada 2 — tokens são sequências máximas fora dos delimitadores.
const DENY_TOKEN_SOURCE = "[^\\s\"'=:,;()<>/\\[\\]{}]+";

// Camada 3 — runs candidatas à entropia.
const RUN_SOURCE = "[A-Za-z0-9+_]+";

type Hit = { kind: RedactKind; start: number; end: number; replace: string };

// Modelo do documento: a saída é uma lista de pedaços na ordem do texto.
// Cada pedaço é texto original intacto (orig=true; `start` é o offset no
// texto de entrada original) ou um marcador já produzido (orig=false), que
// passa a ser opaco para as camadas seguintes. Assim `line` é sempre a linha
// do texto ORIGINAL, mesmo quando o private_key (multi-linha) colapsa linhas.
type Seg = { text: string; start: number; orig: boolean };

export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const n = s.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

function isExemptHex(run: string): boolean {
  // sha de git (40) e sha256 (64) minúsculos ficam intoccados (I9).
  return /^[0-9a-f]{40}$/.test(run) || /^[0-9a-f]{64}$/.test(run);
}

function isExemptIdentifier(run: string): boolean {
  // Identificadores do código-fonte (camelCase longo, snake_case) são
  // puramente alfabéticos/underscore, sem dígitos; segredos de alta
  // entropia reais e canários contêm dígitos ou +.
  return /^[A-Za-z_]+$/.test(run);
}

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function redact(
  text: string,
  opts?: { denylist?: ReadonlySet<string> },
): { text: string; findings: Array<{ kind: RedactKind; line: number }> } {
  if (text.length === 0) return { text: "", findings: [] };

  const findings: Array<{ kind: RedactKind; start: number; line: number }> = [];
  const lineAt = (offset: number): number => {
    let line = 1;
    for (let i = 0; i < offset; i++) {
      if (text.charCodeAt(i) === 10) line++;
    }
    return line;
  };

  let segs: Seg[] = [{ text, start: 0, orig: true }];

  // Aplica um detector sobre os pedaços originais; marcadores existentes
  // são opacos. Se nada casou, o pedaço entra intacto (sem pop()!). Um
  // push a menos aqui corrompia marcadores de camadas anteriores.
  const applyLayer = (find: (chunk: string) => Hit[]): void => {
    const next: Seg[] = [];
    for (const seg of segs) {
      if (!seg.orig) {
        next.push(seg);
        continue;
      }
      const hits = find(seg.text);
      if (hits.length === 0) {
        next.push(seg);
        continue;
      }
      let last = 0;
      for (const hit of hits) {
        if (hit.start > last) {
          next.push({
            text: seg.text.slice(last, hit.start),
            start: seg.start + last,
            orig: true,
          });
        }
        const abs = seg.start + hit.start;
        findings.push({ kind: hit.kind, start: abs, line: lineAt(abs) });
        next.push({ text: hit.replace, start: abs, orig: false });
        last = hit.end;
      }
      if (last < seg.text.length) {
        next.push({
          text: seg.text.slice(last),
          start: seg.start + last,
          orig: true,
        });
      }
    }
    segs = next;
  };

  const regexHits = (
    kind: RedactKind,
    source: string,
    build: (m: RegExpExecArray) => string,
  ): ((chunk: string) => Hit[]) => {
    return (chunk: string): Hit[] => {
      const re = new RegExp(source, "g");
      const hits: Hit[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(chunk)) !== null) {
        hits.push({
          kind,
          start: m.index,
          end: m.index + m[0].length,
          replace: build(m),
        });
        if (m[0].length === 0) re.lastIndex++;
      }
      return hits;
    };
  };

  // Camada 1 — regex.
  for (const [kind, source] of REGEX_LAYERS) {
    applyLayer(
      regexHits(kind, source, (m) =>
        kind === "url_credentials"
          ? m[1]! + marker(kind) + "@"
          : marker(kind),
      ),
    );
  }

  // Camada 2 — denylist por hash do token.
  const denylist = opts?.denylist;
  if (denylist !== undefined && denylist.size > 0) {
    applyLayer((chunk: string): Hit[] => {
      const re = new RegExp(DENY_TOKEN_SOURCE, "g");
      const hits: Hit[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(chunk)) !== null) {
        if (!denylist.has(sha256hex(m[0]!))) continue;
        hits.push({
          kind: "denylist",
          start: m.index,
          end: m.index + m[0]!.length,
          replace: marker("denylist"),
        });
      }
      return hits;
    });
  }

  // Camada 3 — entropia; hex 40/64 de sha/git e identificadores sem
  // dígitos ficam intocados.
  applyLayer((chunk: string): Hit[] => {
    const re = new RegExp(RUN_SOURCE, "g");
    const hits: Hit[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(chunk)) !== null) {
      const run = m[0]!;
      if (run.length < ENTROPY_MIN_LEN) continue;
      if (isExemptHex(run)) continue;
      if (isExemptIdentifier(run)) continue;
      if (shannonEntropy(run) < ENTROPY_MIN_BITS) continue;
      hits.push({
        kind: "entropy",
        start: m.index,
        end: m.index + run.length,
        replace: marker("entropy"),
      });
    }
    return hits;
  });

  findings.sort((a, b) => a.start - b.start);
  return {
    text: segs.map((s) => s.text).join(""),
    findings: findings.map((f) => ({ kind: f.kind, line: f.line })),
  };
}

export function loadDenylist(path: string): Set<string> {
  const raw = readFileSync(path, "utf8");
  const out = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (!/^[0-9a-f]{64}$/i.test(trimmed)) {
      throw new Error(`linha inválida na denylist: ${trimmed}`);
    }
    out.add(trimmed.toLowerCase());
  }
  return out;
}

// Os 7 valores sintéticos do canário, sempre montados em runtime por
// concatenação: nenhum segredo pode aparecer literal em src/ (AC-SEC).
export function canary(): string[] {
  return [
    "sk-ant-" + "api03-" + "FAKE".repeat(10) + "-AAAA",
    "ghp_" + "FAKE".repeat(9),
    "AKIA" + "FAKE".repeat(4),
    "eyJhbGciOiJIUzI1NiJ9" + "." + "eyJzdWIiOiJmYWtlIn0" + "." +
      "ZmFrZS1zaWduYXR1cmU",
    [
      "-----BEGIN OPENSSH " + "PRIVATE KEY-----",
      "RkFLRS1Q" + "UklWQVRF" + "LUtFWS1C" + "T0RZ",
      "-----END OPENSSH " + "PRIVATE KEY-----",
    ].join("\n"),
    "https://deploy:" + "hunter2" + "@git.example.invalid/repo.git",
    "Zq8vR2mX" + "7kLp4Wn9" + "Tb3Yc6Hd" + "1Jf5Gs0Ae",
  ];
}

export function canaryCheck(
  values?: readonly string[],
  opts?: { denylist?: ReadonlySet<string> },
): { ok: true } | { ok: false; survivors: number } {
  let survivors = 0;
  for (const v of values ?? canary()) {
    const r = redact(v, opts);
    if (r.findings.length === 0 || r.text.includes(v)) survivors++;
  }
  return survivors === 0 ? { ok: true } : { ok: false, survivors };
}

export function clip(text: string, max: number = EXCERPT_MAX): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function redactExcerpt(
  text: string | null,
  opts?: { denylist?: ReadonlySet<string> },
): string | null {
  if (text === null || text === "") return null;
  // Redigir antes de cortar: um marcador cortado não esconderia o segredo.
  const red = redact(text, opts).text;
  const clipped = clip(red, EXCERPT_MAX);
  return clipped === "" ? null : clipped;
}
