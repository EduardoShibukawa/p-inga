import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  lstatSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { claudeAdapter } from "./adapters/claude";
import { hermesAdapter } from "./adapters/hermes";
import { opencodeAdapter } from "./adapters/opencode";
import { piAdapter } from "./adapters/pi";
import { tuiosAdapter } from "./adapters/tuios";
import type { Harness, Manifest, ManifestEntry } from "./manifest";
import {
  backupFile,
  defaultManifestPath,
  readManifest,
  sha256File,
  writeAtomic,
} from "./manifest";
import {
  type Change,
  type FileDiff,
  jsonPointerDiff,
  renderDiff,
  withShadow,
} from "./shadow";

const ROOT = resolve(import.meta.dir, "..");

export const INSTALL_EXIT = {
  ok: 0,
  usage: 2,
  infra: 8,
  foreign_key: 11,
  config_invalid: 12,
  revert_drift: 13,
  backup_corrupt: 14,
} as const;

export type AdapterContext = { source: string; now: string };

export type Probe = {
  check: string;
  cmd: (ctx: { source: string }) => string[];
  classify: (r: {
    exit: number;
    stdout: string;
  }) => { status: "ok" | "degraded" | "broken"; detail: string };
};

export type Adapter = {
  harness: Harness;
  bin?: string;
  targets: string[];
  owned: Record<string, string[]>;
  volatile: Record<string, string[]>;
  append?: Record<string, string[]>;
  probes?: Probe[];
  apply(
    shadowHome: string,
    ctx: AdapterContext,
    env?: Record<string, string | undefined>,
  ): void | Promise<void>;
};

export const ADAPTER_ORDER: readonly Harness[] = [
  "pi",
  "claude",
  "opencode",
  "hermes",
  "tuios",
];

const DEFAULT_ADAPTERS: Adapter[] = [
  piAdapter,
  claudeAdapter,
  opencodeAdapter,
  hermesAdapter,
  tuiosAdapter,
];

export type InstallOptions = {
  mode: "dry-run" | "apply" | "revert";
  home: string;
  manifestPath?: string;
  adapters?: Adapter[];
  only?: Harness;
  env?: Record<string, string | undefined>;
};

function sha256hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function infraError(message: string): Error {
  const err = new Error(message) as Error & { code?: string };
  err.code = "infra";
  return err;
}

/**
 * Falha de CLI nativo (exit != 0, spawn ou timeout): erro de infra (exit 8).
 * Implementação em src/shadow.ts; re-exportada aqui para a API pública.
 */
export {
  installTimeoutMs,
  nativeFailError,
  runNative,
} from "./shadow";

export function pickSource(env: Record<string, string | undefined>): string {
  const value = env.PINGA_PI_HARNESS_DIR;
  if (value !== undefined && value !== "") {
    return value;
  }
  const fromCwd = resolve(process.cwd(), "../pi-harness");
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(ROOT, "../pi-harness");
}

function pickNow(env: Record<string, string | undefined>): string {
  const value = env.PINGA_NOW;
  if (value === undefined || value === "") return new Date().toISOString();
  return value;
}

/**
 * Fonte do pi-harness: porta do plugin. As integrações nativas (pi, hermes,
 * tuios) e o arquivo do opencode derivam de `<source>/.pi/skills` — sem
 * skills lá, não há nada a instalar; os adaptadores são pulados em silêncio
 * (compat com a suíte congelada da T12, cujo default do install é claud-only:
 * makeRealisticHome não tem .pi/skills nem stubs).
 */
export function sourceHasPiSkills(source: string): boolean {
  try {
    const dir = join(source, ".pi/skills");
    if (!existsSync(dir)) return false;
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

const SOURCE_GATED_HARNESSES = new Set<string>(["pi", "hermes", "tuios"]);

/** Fonte válida: .claude-plugin/marketplace.json com nome e plugin certos. */
function validateSource(source: string): string | null {
  const manifestPath = join(source, ".claude-plugin/marketplace.json");
  if (!existsSync(manifestPath)) {
    return "fonte sem .claude-plugin/marketplace.json";
  }
  let market: unknown;
  try {
    market = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return "fonte com .claude-plugin/marketplace.json ilegível";
  }
  if (
    typeof market !== "object" ||
    market === null ||
    (market as Record<string, unknown>).name !== "pi-harness-local"
  ) {
    return "fonte com .claude-plugin/marketplace.json sem name: pi-harness-local";
  }
  const plugins = (market as Record<string, unknown>).plugins;
  if (
    !Array.isArray(plugins) ||
    !plugins.some(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as Record<string, unknown>).name === "pi-harness",
    )
  ) {
    return "fonte sem o plugin pi-harness";
  }
  return null;
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith("/")) return [];
  return pointer
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function pointerExists(doc: unknown, pointer: string): boolean {
  if (pointer === "") return true;
  let current: unknown = doc;
  for (const seg of pointerSegments(pointer)) {
    if (current === null || typeof current !== "object") return false;
    if (Array.isArray(current)) {
      const i = Number(seg);
      if (!Number.isInteger(i) || i < 0 || i >= current.length) return false;
      current = current[i];
    } else {
      if (!(seg in current)) return false;
      current = (current as Record<string, unknown>)[seg];
    }
  }
  return true;
}

function isConfigInvalid(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e as Error & { code?: string }).code === "config_invalid"
  );
}

/**
 * Guarda A2 (estendida T13): ponteiro alheio ou entrada homônima não
 * registrada no manifest. Sob um prefixo de `append` só `+` é aceito
 * (só-acréscimo); `~`/`-` só passam se o pinga já registrou esse ponteiro
 * (ou um ancestral dele) como key_path no manifest. Nos prefixos de `append`
 * não há checagem de homônima (o TUIOS é "terceiro conhecido", §A.4).
 */
export function checkForeign(input: {
  adapter: Adapter;
  file: string;
  before: unknown;
  after: unknown;
  changes: Change[];
  manifest: Manifest;
}): { ok: true } | { ok: false; pointers: string[] } {
  // Alvo sem documento anterior (novo na sombra): nada para conflitar (T12).
  if (input.before === undefined) return { ok: true };

  const appendPrefixes = input.adapter.append?.[input.file] ?? [];
  const owned = input.adapter.owned[input.file] ?? [];
  const isUnderAppend = (pointer: string): boolean =>
    appendPrefixes.some(
      (p) => pointer === p || pointer.startsWith(`${p}/`),
    );
  const bad: string[] = [];
  for (const change of input.changes) {
    if (isUnderAppend(change.pointer)) {
      if (change.op === "+") continue;
      const registered = input.manifest.entries.some(
        (e) =>
          e.harness === input.adapter.harness &&
          e.target_file === input.file &&
          e.key_path !== undefined &&
          (change.pointer === e.key_path ||
            change.pointer.startsWith(`${e.key_path}/`)),
      );
      if (!registered) bad.push(change.pointer);
      continue;
    }
    const allowed = owned.some(
      (ownedPtr) =>
        change.pointer === ownedPtr ||
        change.pointer.startsWith(`${ownedPtr}/`),
    );
    if (!allowed) bad.push(change.pointer);
  }

  // Homônima: chave que é do pinga e já existia, sem registro no manifest.
  for (const ownedPtr of owned) {
    if (!pointerExists(input.before, ownedPtr)) continue;
    const registered = input.manifest.entries.some(
      (e) =>
        e.harness === input.adapter.harness &&
        e.target_file === input.file &&
        (e.key_path === ownedPtr || e.key_path === undefined),
    );
    if (!registered) bad.push(ownedPtr);
  }

  if (bad.length > 0) {
    return { ok: false, pointers: Array.from(new Set(bad)).sort() };
  }
  return { ok: true };
}

/** Ponteiros de primeiro nível acrescentados sob prefixos de `append` (para o manifest). */
function appendKeyPathsOf(changes: Change[], appendPrefixes: string[]): string[] {
  const added = changes
    .filter(
      (c) =>
        c.op === "+" &&
        appendPrefixes.some(
          (p) => c.pointer === p || c.pointer.startsWith(`${p}/`),
        ),
    )
    .map((c) => c.pointer);
  return added.filter(
    (p) => !added.some((q) => q !== p && p.startsWith(`${q}/`)),
  );
}

function matchesTarget(targets: string[], rel: string): boolean {
  return targets.some(
    (t) => t === rel || (t.endsWith("/") && rel.startsWith(t)),
  );
}

function isStructuredExt(rel: string): boolean {
  const base = extname(rel);
  return base === ".json" || base === ".yaml" || base === ".yml";
}

type SnapshotEntry = {
  sha: string;
  doc: unknown;
  docValid: boolean;
  isSymlink: boolean;
};
type Snapshot = Map<string, SnapshotEntry>;

function parseStructuredDoc(abs: string, rel: string): unknown {
  const raw = readFileSync(abs, "utf8");
  if (extname(rel) === ".json") return JSON.parse(raw);
  return Bun.YAML.parse(raw);
}

/** Estado dos alvos na sombra: sha256 (symlink-aware) e doc estruturado (JSON/YAML). */
function snapshotShadow(shadowHome: string, allTargets: string[]): Snapshot {
  const snap: Snapshot = new Map();
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(shadowHome, abs).replace(/\\/g, "/");
      const st = lstatSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!matchesTarget(allTargets, rel)) continue;
      const entry: SnapshotEntry = {
        sha: sha256File(abs),
        doc: undefined,
        docValid: false,
        isSymlink: st.isSymbolicLink(),
      };
      if (isStructuredExt(rel) && !st.isSymbolicLink()) {
        try {
          entry.doc = parseStructuredDoc(abs, rel);
          entry.docValid = true;
        } catch {
          entry.docValid = false;
        }
      }
      snap.set(rel, entry);
    }
  }
  if (existsSync(shadowHome)) walk(shadowHome);
  return snap;
}

type FileOp = { bytes?: Buffer; symlink?: string };

type FileSpec = {
  adapter: Adapter;
  file: string;
  status: "new" | "changed" | "removed";
  appendKeyPaths: string[];
};

/** Arquivos/symlinks na sombra que não são alvos de nenhum adaptador. */
function scanForeignFiles(shadowHome: string, allTargets: string[]): string[] {
  const foreign: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(shadowHome, abs).replace(/\\/g, "/");
      const st = lstatSync(abs);
      if (st.isDirectory()) {
        walk(abs);
      } else if (!matchesTarget(allTargets, rel)) {
        foreign.push(rel);
      } else if (st.isSymbolicLink() && !existsSync(abs)) {
        foreign.push(rel);
      }
    }
  }
  if (existsSync(shadowHome)) walk(shadowHome);
  return foreign.sort();
}

/** Alvo estruturado ilegível no HOME real (JSON/YAML inválido): exit 12. */
function validateExistingTargets(
  home: string,
  targets: string[],
): string | null {
  for (const file of targets) {
    if (file.endsWith("/")) continue;
    if (!isStructuredExt(file)) continue;
    const abs = join(home, file);
    if (!existsSync(abs)) continue;
    const base = extname(file);
    let doc: unknown;
    try {
      doc = parseStructuredDoc(abs, file);
    } catch {
      return `${file} ilegível (JSON/YAML inválido)`;
    }
    if (base === ".yaml" || base === ".yml") {
      if (
        doc === null ||
        typeof doc !== "object" ||
        Array.isArray(doc)
      ) {
        return `${file} deve ser documento YAML objeto`;
      }
    }
    if (file.endsWith("installed_plugins.json")) {
      if (
        doc === null ||
        typeof doc !== "object" ||
        (doc as Record<string, unknown>).version !== 2
      ) {
        return `${file}: version != 2`;
      }
    }
  }
  return null;
}

function installMissingInstallBin(
  adapter: Adapter,
  env: Record<string, string | undefined>,
): string | null {
  // claude e opencode usam escritor próprio no apply; o bin é só do doctor.
  if (adapter.bin === undefined || adapter.bin === "") return null;
  if (adapter.harness === "claude" || adapter.harness === "opencode") {
    return null;
  }
  const PATH = env.PATH ?? "";
  return Bun.which(adapter.bin, { PATH }) === null ? adapter.bin : null;
}

function upsertEntry(
  entries: ManifestEntry[],
  harness: Harness,
  file: string,
  keyPath: string | undefined,
  preSha: string,
  postSha: string,
  installedAt: string,
  backupPath: string,
): void {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (
      e.harness === harness &&
      e.target_file === file &&
      (e.key_path ?? undefined) === (keyPath ?? undefined)
    ) {
      entries.splice(i, 1);
    }
  }
  entries.push({
    harness,
    target_file: file,
    ...(keyPath !== undefined ? { key_path: keyPath } : {}),
    sha256_pre: preSha,
    sha256_post: postSha,
    installed_at: installedAt,
    backup_path: backupPath,
  });
}

function restoreFromBackup(abs: string, backupBytes: Buffer): void {
  const asText = backupBytes.toString("utf8");
  if (asText.startsWith("symlink:")) {
    rmSync(abs, { force: true });
    symlinkSync(asText.slice("symlink:".length), abs);
  } else {
    writeAtomic(abs, backupBytes);
  }
}

function rmTarget(abs: string): void {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) unlinkSync(abs);
  else rmSync(abs, { force: true });
}

async function revertCmd(
  opts: InstallOptions,
  manifestPath: string,
): Promise<number> {
  let manifest: Manifest;
  try {
    manifest = readManifest(manifestPath);
  } catch (e) {
    console.error(`pinga install: ${errorMessage(e)}`);
    return INSTALL_EXIT.config_invalid;
  }

  if (manifest.entries.length === 0) {
    console.log("nada a reverter");
    return INSTALL_EXIT.ok;
  }

  const home = opts.home;

  // Pré-checagem antes de escrever qualquer coisa (I17).
  const drift: string[] = [];
  for (const entry of manifest.entries) {
    if (sha256File(join(home, entry.target_file)) !== entry.sha256_post) {
      if (!drift.includes(entry.target_file)) drift.push(entry.target_file);
    }
  }
  if (drift.length > 0) {
    for (const file of drift.sort()) {
      console.error(`pinga install: drift em ${file} (sha256 atual != sha256_post)`);
    }
    return INSTALL_EXIT.revert_drift;
  }

  for (const entry of manifest.entries) {
    if (entry.backup_path === "") continue;
    if (sha256File(entry.backup_path) !== entry.sha256_pre) {
      console.error(
        `pinga install: backup ausente ou corrompido: ${entry.backup_path}`,
      );
    }
  }
  for (const entry of manifest.entries) {
    if (entry.backup_path === "") continue;
    if (sha256File(entry.backup_path) !== entry.sha256_pre) {
      return INSTALL_EXIT.backup_corrupt;
    }
  }

  // Restaura (arquivo regular ou symlink) e confere.
  const restored = new Set<string>();
  for (const entry of manifest.entries) {
    const target = join(home, entry.target_file);
    const abs = target;
    if (restored.has(abs)) continue;
    restored.add(abs);
    if (entry.sha256_pre === "absent") {
      rmSync(abs, { force: true });
    } else {
      restoreFromBackup(abs, readFileSync(entry.backup_path));
    }
    if (sha256File(abs) !== entry.sha256_pre) {
      console.error(
        `pinga install: restauração não conferiu para ${entry.target_file}`,
      );
      return INSTALL_EXIT.infra;
    }
  }

  writeAtomic(
    manifestPath,
    JSON.stringify({ version: 1, entries: [] }, null, 2) + "\n",
  );
  return INSTALL_EXIT.ok;
}

export async function installCmd(opts: InstallOptions): Promise<number> {
  const env = opts.env ?? process.env;
  const manifestPath = opts.manifestPath ?? defaultManifestPath(env);
  const planPath = join(dirname(manifestPath), "install-plan.json");
  const stateDir = dirname(manifestPath);
  const source = pickSource(env);
  const now = pickNow(env);

  // --only fora da ordem -> exit 2 (nunca roda nada).
  const only = opts.only;
  if (only !== undefined && !ADAPTER_ORDER.includes(only)) {
    console.error(`pinga install: --only inválido: ${String(only)}`);
    return INSTALL_EXIT.usage;
  }

  let adapters = opts.adapters ?? DEFAULT_ADAPTERS;
  if (opts.adapters === undefined && only !== undefined) {
    adapters = adapters.filter((a) => a.harness === only);
  }

  // Ajuda testes diretos (sem spawn): roda a sombra no TMPDIR do env informado.
  const envTmp = env.TMPDIR;
  const prevTmp =
    envTmp !== undefined && envTmp !== "" ? process.env.TMPDIR : undefined;

  try {
    if (envTmp !== undefined && envTmp !== "") {
      process.env.TMPDIR = envTmp;
    }

    if (opts.mode === "revert") {
      return await revertCmd(opts, manifestPath);
    }

    if (adapters.some((a) => a.harness === "claude")) {
      const problem = validateSource(source);
      if (problem !== null) {
        console.error(`pinga install: ${problem}: ${source}`);
        return INSTALL_EXIT.usage;
      }
    }

    // 1. Manifest e alvos existentes do HOME real (JSON/YAML) já válidos.
    let manifest: Manifest;
    try {
      manifest = readManifest(manifestPath);
    } catch (e) {
      console.error(`pinga install: ${errorMessage(e)}`);
      return INSTALL_EXIT.config_invalid;
    }

    const allTargets = [...new Set(adapters.flatMap((a) => a.targets))].sort();
    const targetProblem = validateExistingTargets(opts.home, allTargets);
    if (targetProblem !== null) {
      console.error(`pinga install: ${targetProblem}`);
      return INSTALL_EXIT.config_invalid;
    }

    const hasPiSkills = sourceHasPiSkills(source);

    let flowExit = 0;
    let renderedDiff = "";
    const dirtyFiles = new Map<string, FileOp>();
    const unlinkFiles = new Set<string>();
    const specsByFile = new Map<string, FileSpec[]>();

    // 2. HOME-sombra: aplica os adaptadores na ordem, com diff/guarda por etapa.
    await withShadow(opts.home, allTargets, async (shadowHome: string) => {
      const initial = snapshotShadow(shadowHome, allTargets);
      const sections: Array<{
        harness: string;
        files: FileDiff[];
        skippedReason?: string;
      }> = [];

      for (const adapter of adapters) {
        const section: FileDiff[] = [];

        // Fonte sem .pi/skills: integrações nativas puladas em silêncio.
        if (SOURCE_GATED_HARNESSES.has(adapter.harness) && !hasPiSkills) {
          sections.push({ harness: adapter.harness, files: [] });
          continue;
        }

        // CLI nativo sem binário no PATH: pulado com a seção visível (T13).
        const missing = installMissingInstallBin(adapter, env);
        if (missing !== null) {
          sections.push({
            harness: adapter.harness,
            files: [],
            skippedReason: `${missing} ausente`,
          });
          continue;
        }

        const before = snapshotShadow(shadowHome, allTargets);
        try {
          await adapter.apply(shadowHome, { source, now }, env);
        } catch (e) {
          if (isConfigInvalid(e)) {
            console.error(`pinga install: ${errorMessage(e)}`);
            flowExit = INSTALL_EXIT.config_invalid;
          } else {
            console.error(
              `pinga install: adaptador ${adapter.harness} falhou: ${errorMessage(e)}`,
            );
            flowExit = INSTALL_EXIT.infra;
          }
          return;
        }

        // O apply de um adaptador não pode criar nem mexer fora dos alvos.
        const foreign = scanForeignFiles(shadowHome, allTargets);
        if (foreign.length > 0) {
          for (const rel of foreign) {
            console.error(`fora dos alvos: ${rel}`);
          }
          flowExit = INSTALL_EXIT.foreign_key;
          return;
        }

        // 3. Diff da etapa + guarda A2 (extensões/só-acréscimo/homônima).
        const after = snapshotShadow(shadowHome, allTargets);
        const changedRels = [...new Set([...before.keys(), ...after.keys()])]
          .filter((rel) => before.get(rel)?.sha !== after.get(rel)?.sha)
          .sort();

        for (const rel of changedRels) {
          if (!matchesTarget(adapter.targets, rel)) {
            console.error(
              `pinga install: ${adapter.harness} alterou alvo de outro adaptador: ${rel}`,
            );
            flowExit = INSTALL_EXIT.foreign_key;
            return;
          }

          const bInfo = before.get(rel);
          const aInfo = after.get(rel);
          const beforeHas = bInfo !== undefined;
          const afterHas = aInfo !== undefined;
          const status: FileSpec["status"] = !afterHas
            ? "removed"
            : !beforeHas
              ? "new"
              : "changed";

          const afterSymlink = afterHas ? aInfo!.isSymlink : false;
          const beforeSymlink = beforeHas ? bInfo!.isSymlink : false;
          const kind =
            fileKind(adapter, rel, afterSymlink) ===
            fileKind(adapter, rel, beforeSymlink)
              ? fileKind(adapter, rel, afterSymlink)
              : "whole";

          if (kind === "whole") {
            // Arquivo inteiro (novo/alterado/removido): novo é aceito; existente
            // exige ManifestEntry sem key_path para (harness, relPath).
            if (initial.has(rel)) {
              const registered = manifest.entries.some(
                (e) =>
                  e.harness === adapter.harness &&
                  e.target_file === rel &&
                  e.key_path === undefined,
              );
              if (!registered) {
                console.error(
                  `pinga install: chave alheia ou homônima em ${rel}: /`,
                );
                flowExit = INSTALL_EXIT.foreign_key;
                return;
              }
            }
            section.push({
              file: rel,
              status,
              changes: [
                {
                  op: status === "removed" ? "-" : status === "new" ? "+" : "~",
                  pointer: "/",
                  ...(status !== "new" ? { before: bInfo?.sha } : {}),
                  ...(status !== "removed" ? { after: aInfo?.sha } : {}),
                },
              ],
            });
            if (status === "removed") unlinkFiles.add(rel);
            else dirtyFiles.set(rel, captureFileOp(join(shadowHome, rel)));
            specsByFile.set(rel, [
              ...(specsByFile.get(rel) ?? []),
              { adapter, file: rel, status, appendKeyPaths: [] },
            ]);
            continue;
          }

          // Estruturado (JSON/YAML): diff por ponteiro + guardas.
          const beforeDoc = beforeHas && bInfo!.docValid ? bInfo!.doc : undefined;
          const afterDoc = afterHas && aInfo!.docValid ? aInfo!.doc : undefined;
          if (
            (beforeHas && !bInfo!.docValid) ||
            (afterHas && !aInfo!.docValid)
          ) {
            console.error(
              `pinga install: ${rel} ilegível na sombra (JSON/YAML inválido)`,
            );
            flowExit = INSTALL_EXIT.infra;
            return;
          }

          const changes = jsonPointerDiff(
            beforeDoc,
            afterDoc,
            adapter.volatile[rel] ?? [],
          );
          if (changes.length === 0) continue;

          const guard = checkForeign({
            adapter,
            file: rel,
            before: beforeDoc,
            after: afterDoc,
            changes,
            manifest,
          });
          if (!guard.ok) {
            console.error(
              `pinga install: chave alheia ou homônima em ${rel}: ${guard.pointers.join(", ")}`,
            );
            flowExit = INSTALL_EXIT.foreign_key;
            return;
          }

          const appendPrefixes = adapter.append?.[rel] ?? [];
          const appendKeyPaths = appendKeyPathsOf(changes, appendPrefixes);
          section.push({ file: rel, status, changes });
          if (status === "removed") unlinkFiles.add(rel);
          else dirtyFiles.set(rel, captureFileOp(join(shadowHome, rel)));
          specsByFile.set(rel, [
            ...(specsByFile.get(rel) ?? []),
            { adapter, file: rel, status, appendKeyPaths },
          ]);
        }

        sections.push({ harness: adapter.harness, files: section });
      }

      renderedDiff = renderDiff(sections);
    });

    if (flowExit !== 0) return flowExit;

    const diffSha = sha256hex(renderedDiff);

    if (opts.mode === "dry-run") {
      writeAtomic(
        planPath,
        JSON.stringify({ diff_sha256: diffSha }, null, 2) + "\n",
      );
      if (renderedDiff !== "") process.stdout.write(renderedDiff);
      return INSTALL_EXIT.ok;
    }

    // 4. --apply: nada real a escrever (idempotência, I16/manifest intocado).
    if (dirtyFiles.size === 0 && unlinkFiles.size === 0) {
      return INSTALL_EXIT.ok;
    }
    if (renderedDiff === "") return INSTALL_EXIT.ok;

    let planSha: string | undefined;
    if (existsSync(planPath)) {
      try {
        const parsed = JSON.parse(readFileSync(planPath, "utf8")) as {
          diff_sha256?: unknown;
        };
        if (typeof parsed.diff_sha256 === "string") planSha = parsed.diff_sha256;
      } catch {
        planSha = undefined;
      }
    }
    if (planSha === undefined || planSha !== diffSha) {
      console.error(
        "pinga install: --apply exige um --dry-run prévio com o mesmo diff (revise com pinga install --dry-run)",
      );
      return INSTALL_EXIT.usage;
    }

    // 5. Backup por sha256, cópia atômica sombra -> real, conferência.
    const preByFile = new Map<string, string>();
    const backupsForRollback: Array<{ file: string; backup_path: string }> = [];
    try {
      mkdirSync(stateDir, { recursive: true });
      const backupPathByFile = new Map<string, string>();

      // Backups de TUDO antes de escrever o primeiro byte (rollback fiel).
      for (const file of [...dirtyFiles.keys(), ...unlinkFiles]) {
        const abs = join(opts.home, file);
        const preSha = sha256File(abs);
        preByFile.set(file, preSha);
        if (preSha !== "absent") {
          const backup = backupFile(stateDir, abs);
          backupsForRollback.push({ file, backup_path: backup.backup_path });
          backupPathByFile.set(file, backup.backup_path);
        }
      }

      for (const [file, op] of dirtyFiles) {
        const abs = join(opts.home, file);
        if (op.symlink !== undefined) {
          writeAtomic(abs, { symlink: op.symlink });
        } else if (op.bytes !== undefined) {
          writeAtomic(abs, op.bytes);
        } else {
          rmSync(abs, { force: true });
          unlinkFiles.add(file);
        }
      }
      for (const file of unlinkFiles) {
        const abs = join(opts.home, file);
        if (existsSync(abs) || lstatSafe(abs)) rmTarget(abs);
      }

      for (const [file, op] of dirtyFiles) {
        const abs = join(opts.home, file);
        const actual = sha256File(abs);
        const expected =
          op.symlink !== undefined
            ? sha256hex(`symlink:${op.symlink}`)
            : sha256hex(new Uint8Array(op.bytes ?? new Uint8Array(0)));
        if (actual !== expected) {
          throw infraError(`sombra -> real falhou para ${file}`);
        }
      }

      // 6. Manifest atômico: entradas por ponteiro (owned/append/new) e
      //    sha256_pre/post compartilhados entre harnesses do mesmo arquivo.
      const entries =
        applyManifestEntries(
          manifest,
          dirtyFiles,
          unlinkFiles,
          specsByFile,
          preByFile,
          backupPathByFile,
          opts.home,
          stateDir,
          now,
        );
      writeAtomic(
        manifestPath,
        JSON.stringify({ version: 1, entries }, null, 2) + "\n",
      );
      rmSync(planPath, { force: true });
      process.stdout.write(renderedDiff);
      return INSTALL_EXIT.ok;
    } catch (e) {
      // Rollback: todo arquivo "tocado" volta ao estado pré-apply — de backup
      // (regular ou symlink: "symlink:<alvo>") ou nem existia ("absent").
      const backupPathByFile = new Map(
        backupsForRollback.map((b) => [b.file, b.backup_path]),
      );
      for (const file of new Set([...dirtyFiles.keys(), ...unlinkFiles])) {
        const abs = join(opts.home, file);
        const backupPath = backupPathByFile.get(file);
        if (backupPath !== undefined && existsSync(backupPath)) {
          restoreFromBackup(abs, readFileSync(backupPath));
        } else {
          rmSync(abs, { force: true });
        }
      }
      console.error(`pinga install: ${errorMessage(e)}`);
      return INSTALL_EXIT.infra;
    }
  } finally {
    if (envTmp !== undefined && envTmp !== "") {
      if (prevTmp === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = prevTmp;
    }
  }
}

function isSymlinkAt(abs: string): boolean {
  try {
    return lstatSync(abs).isSymbolicLink();
  } catch {
    return false;
  }
}

function lstatSafe(abs: string): boolean {
  try {
    lstatSync(abs);
    return true;
  } catch {
    return false;
  }
}

function fileKind(
  adapter: Adapter,
  rel: string,
  isSymlink: boolean,
): "structured" | "whole" {
  for (const t of adapter.targets) {
    if (t.endsWith("/") && rel.startsWith(t)) return "whole";
  }
  if (isSymlink) return "whole";
  return isStructuredExt(rel) ? "structured" : "whole";
}

function captureFileOp(abs: string): FileOp {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) return { symlink: readlinkSync(abs) };
  return { bytes: readFileSync(abs) };
}

function applyManifestEntries(
  manifest: Manifest,
  dirtyFiles: Map<string, FileOp>,
  unlinkFiles: Set<string>,
  specsByFile: Map<string, FileSpec[]>,
  preByFile: Map<string, string>,
  backupPathByFile: Map<string, string>,
  home: string,
  stateDir: string,
  now: string,
): ManifestEntry[] {
  const entries = [...manifest.entries];
  for (const [file] of specsByFile) {
    if (!dirtyFiles.has(file)) continue; // removido: sem entrada de remoção (remoção semântica fica para a v0.2)
    const preSha = preByFile.get(file) ?? sha256File(join(home, file));
    // O backup já foi criado ANTES de qualquer escrita (rollback fiel); aqui é
    // só reaproveitar o caminho dele — nunca fazer backup do arquivo escrita.
    const backupPathByPre = backupPathByFile.get(file);
    const backupPath =
      preSha !== "absent"
        ? (backupPathByPre ??
          backupFile(stateDir, join(home, file)).backup_path)
        : "";
    const postSha = sha256File(join(home, file));

    // sha256_pre/post/backup_path compartilhados por todos os harnesses do arquivo.
    for (const e of entries) {
      if (e.target_file === file) {
        e.sha256_pre = preSha;
        e.sha256_post = postSha;
        e.backup_path = backupPath;
        e.installed_at = now;
      }
    }

    for (const spec of specsByFile.get(file) ?? []) {
      if (spec.status === "removed") continue;
      const keyPaths: Array<string | undefined> = [];
      if (spec.status === "new") keyPaths.push(undefined);
      if (spec.status === "changed") {
        for (const ownedPtr of spec.adapter.owned[file] ?? []) {
          keyPaths.push(ownedPtr);
        }
      }
      keyPaths.push(...spec.appendKeyPaths);
      // Dedupe caso owned e append itens de mesma key (não deve acontecer).
      for (const keyPath of keyPaths) {
        upsertEntry(
          entries,
          spec.adapter.harness,
          file,
          keyPath,
          preSha,
          postSha,
          now,
          backupPath,
        );
      }
    }
  }
  return entries;
}

