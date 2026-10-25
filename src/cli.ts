import { evalPlan } from "./eval";
import { examplesPlan } from "./examples";
import { existsSync, readFileSync } from "node:fs";
import { judgePlan } from "./judge";
import { modePlan } from "./mode";
import { precommitDecision } from "./guards";
import { ADAPTER_ORDER, installCmd } from "./install";
import { defaultLedgerPath, openLedger } from "./ledger";
import { defaultManifestPath, type Harness } from "./manifest";
import { adoptLocalEntries } from "./adopt";
import { provePlan } from "./prove";
import { verifyPlan } from "./verify";
import { doctorCmd } from "./doctor";
import { defaultLearnDbPath, ingest, ingestMultiHarness, LEARN_EXIT, openLearnDb } from "./learn";
import { promoteCmd, proposeCmd } from "./lessons";
import { auditNoVerify, evaluateLessonsPrecision } from "./audit";
import { loadDenylist, redact } from "./redact";
import { resolve } from "node:path";
import {
  computeWorkerScoreboard,
  createTaskRequest,
  formatMaestroDigest,
  recommendOrchestration,
} from "./maestro";

const USAGE = `usage: pinga ledger verify [--ledger PATH]
       pinga verify <PLAN.md> [--ledger PATH] [--attempt N] [--base SHA] [--usage-file PATH] [--override-mode M --reason TEXTO] [--prove-base]
       pinga prove-red <PLAN.md> [--ledger PATH] [--base SHA]
       pinga mode <PLAN.md> [--base SHA] [--override-mode M --reason TEXTO]
       pinga judge <PLAN.md> [--ledger PATH] [--judge-model M] [--endpoint URL] [--base SHA] [--usage-file PATH]
       pinga eval <PLAN.md> [--ledger PATH] [--check]
       pinga examples <PLAN.md> --from PATH
       pinga learn ingest [--ledger PATH] [--evals DIR] [--sessions DIR] [--db PATH] [--repo NOME] [--denylist PATH]
                          [--pi DIR] [--opencode DB] [--hermes DB] [--friction FILE]
       pinga learn scan <arquivo...> [--allow PATH]... [--denylist PATH]
       pinga learn propose [--db PATH] [--out PATH] [--judge-model M] [--judge-endpoint URL]
       pinga learn promote <PROPOSED.md> --id <L-…> --to <LESSONS.md> [--by NOME]
       pinga learn audit [--db PATH] [--repo PATH] [--sample N] [--threshold T] [--json]
       pinga precommit [-- <cmd...>]
       pinga install (--dry-run | --apply | --revert) [--only H] [--manifest PATH] [--home PATH]
       pinga adopt (--dry-run | --apply) [--home PATH] [--manifest PATH]
       pinga doctor [--json] [--only H] [--endpoint URL] [--home PATH] [--manifest PATH]
       pinga maestro scoreboard [--ledger PATH] [--db PATH] [--json]
       pinga maestro recommend <PLAN.md> [--ledger PATH] [--db PATH] [--json]
       pinga maestro envelope <PLAN.md> [--ledger PATH] [--json]
       pinga maestro digest [--ledger PATH] [--db PATH] [--send] [--json]`;

/**
 * `pinga learn scan <arquivo...>`: aplica o scanner a cada arquivo e imprime
 * `<arquivo>:<linha>: <kind>` por achado — nunca o valor. Arquivos com byte
 * NUL são pulados (binário); ilegível → exit 8; algum achado → exit 1.
 */
function learnScan(args: string[]): number {
  const files: string[] = [];
  const allow = new Set<string>();
  let denylistPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--allow") {
      const value = args[i + 1];
      if (value === undefined || value === "") {
        console.error(USAGE);
        return 2;
      }
      allow.add(value);
      allow.add(resolve(value));
      i++;
    } else if (arg === "--denylist") {
      const value = args[i + 1];
      if (value === undefined || value === "") {
        console.error(USAGE);
        return 2;
      }
      denylistPath = value;
      i++;
    } else if (arg.startsWith("--")) {
      console.error(USAGE);
      return 2;
    } else {
      files.push(arg);
    }
  }

  if (files.length === 0) {
    console.error(USAGE);
    return 2;
  }

  let denylist: ReadonlySet<string> | undefined;
  if (denylistPath !== undefined) {
    try {
      denylist = loadDenylist(denylistPath);
    } catch (err) {
      console.error(`learn scan: denylist inválida: ${(err as Error).message}`);
      return 2;
    }
  }

  let found = 0;
  for (const file of files) {
    if (allow.has(file) || allow.has(resolve(file))) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(file);
    } catch (err) {
      console.error(
        `learn scan: não foi possível ler ${file}: ${(err as Error).message}`,
      );
      return LEARN_EXIT.infra;
    }
    if (bytes.includes(0)) continue; // binário: pulado
    for (const f of redact(bytes.toString("utf8"), { denylist }).findings) {
      console.log(`${file}:${f.line}: ${f.kind}`);
      found++;
    }
  }

  return found > 0 ? 1 : LEARN_EXIT.ok;
}

/**
 * O git exporta variáveis de contexto de repositório para os processos de
 * hook (ex.: GIT_INDEX_FILE=.git/index durante `git commit`). Herdar essas
 * variáveis quebra o git em repositórios criados pela própria suíte de
 * testes (ex.: `git worktree add` da prova no base, T11).
 */
const GIT_CONTEXT_ENV_KEYS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_QUARANTINE_PATH",
  "GIT_INTERNAL_SUPER_PREFIX",
  "GIT_PREFIX",
];

function cleanGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !GIT_CONTEXT_ENV_KEYS.includes(key)) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * T16: fontes multi-harness via CLI — ingest com redação 3 camadas e
 * blocklist de credenciais; contagens reportadas em JSON.
 */
async function learnIngestMulti(opts: {
  dbPath: string;
  piDir?: string;
  opencodeDb?: string;
  hermesDb?: string;
  frictionFile?: string;
}): Promise<number> {
  const result = await ingestMultiHarness(opts);
  console.log(JSON.stringify(result));
  return LEARN_EXIT.ok;
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, subcommand, ...rest] = argv;

  if (command === "ledger" && subcommand === "verify") {
    let ledgerPath = defaultLedgerPath();
    const flagIndex = rest.indexOf("--ledger");
    if (flagIndex !== -1) {
      const value = rest[flagIndex + 1];
      if (value === undefined || value === "") {
        console.error(USAGE);
        return 2;
      }
      ledgerPath = value;
    }

    const ledger = openLedger(ledgerPath);
    try {
      const result = ledger.verify();
      if (result.ok) {
        console.log(`ok ${result.count}`);
        return 0;
      }
      console.log(`broken at ${result.brokenAt}`);
      return 1;
    } finally {
      ledger.close();
    }
  }

  if (command === "verify") {
    const planPath = subcommand;
    if (planPath === undefined || planPath === "" || planPath.startsWith("--")) {
      console.error(USAGE);
      return 2;
    }

    let ledgerPath: string | undefined;
    let attempt: number | undefined;
    let base: string | undefined;
    let usageFile: string | undefined;
    let overrideMode: string | undefined;
    let reason: string | undefined;
    let proveBase = false;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--ledger") {
        const value = rest[i + 1];
        if (value === undefined || value === "") {
          console.error(USAGE);
          return 2;
        }
        ledgerPath = value;
        i++;
      } else if (arg === "--attempt") {
        const value = rest[i + 1];
        const n = value === undefined ? Number.NaN : Number(value);
        if (!Number.isInteger(n) || n < 1) {
          console.error(USAGE);
          return 2;
        }
        attempt = n;
        i++;
      } else if (arg === "--base") {
        const value = rest[i + 1];
        if (value === undefined || value === "" || value.startsWith("--")) {
          console.error(USAGE);
          return 2;
        }
        base = value;
        i++;
      } else if (arg === "--usage-file") {
        const value = rest[i + 1];
        if (value === undefined || value === "" || value.startsWith("--")) {
          console.error(USAGE);
          return 2;
        }
        usageFile = value;
        i++;
      } else if (arg === "--override-mode") {
        const value = rest[i + 1];
        if (value === undefined || value === "" || value.startsWith("--")) {
          console.error(USAGE);
          return 2;
        }
        overrideMode = value;
        i++;
      } else if (arg === "--reason") {
        const value = rest[i + 1];
        if (value === undefined || value === "") {
          console.error(USAGE);
          return 2;
        }
        reason = value;
        i++;
      } else if (arg === "--prove-base") {
        proveBase = true;
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    return verifyPlan(planPath, ledgerPath, attempt, {
      base,
      usageFile,
      overrideMode,
      reason,
      proveBase,
    });
  }

  if (command === "prove-red") {
    const planPath = subcommand;
    if (planPath === undefined || planPath === "" || planPath.startsWith("--")) {
      console.error(USAGE);
      return 2;
    }

    let ledgerPath: string | undefined;
    let base: string | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--ledger") {
        const value = rest[i + 1];
        if (value === undefined || value === "") {
          console.error(USAGE);
          return 2;
        }
        ledgerPath = value;
        i++;
      } else if (arg === "--base") {
        const value = rest[i + 1];
        if (value === undefined || value === "" || value.startsWith("--")) {
          console.error(USAGE);
          return 2;
        }
        base = value;
        i++;
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    return provePlan(planPath, { ledgerPath, base });
  }

  if (command === "mode") {
    const planPath = subcommand;
    if (planPath === undefined || planPath === "" || planPath.startsWith("--")) {
      console.error(USAGE);
      return 2;
    }

    let base: string | undefined;
    let overrideMode: string | undefined;
    let reason: string | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--base") {
        const value = rest[i + 1];
        if (value === undefined || value === "" || value.startsWith("--")) {
          console.error(USAGE);
          return 2;
        }
        base = value;
        i++;
      } else if (arg === "--override-mode") {
        const value = rest[i + 1];
        if (value === undefined || value === "" || value.startsWith("--")) {
          console.error(USAGE);
          return 2;
        }
        overrideMode = value;
        i++;
      } else if (arg === "--reason") {
        const value = rest[i + 1];
        if (value === undefined || value === "") {
          console.error(USAGE);
          return 2;
        }
        reason = value;
        i++;
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    return modePlan(planPath, { base, overrideMode, reason });
  }

  if (command === "judge") {
    const planPath = subcommand;
    if (planPath === undefined || planPath === "" || planPath.startsWith("--")) {
      console.error(USAGE);
      return 2;
    }

    let ledgerPath: string | undefined;
    let judgeModel: string | undefined;
    let endpoint: string | undefined;
    let base: string | undefined;
    let usageFile: string | undefined;

    const valueFlags = new Set([
      "--ledger",
      "--judge-model",
      "--endpoint",
      "--base",
      "--usage-file",
    ]);

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (valueFlags.has(arg)) {
        const value = rest[i + 1];
        if (value === undefined || value === "" || value.startsWith("--")) {
          console.error(USAGE);
          return 2;
        }
        if (arg === "--ledger") ledgerPath = value;
        else if (arg === "--judge-model") judgeModel = value;
        else if (arg === "--endpoint") endpoint = value;
        else if (arg === "--base") base = value;
        else if (arg === "--usage-file") usageFile = value;
        i++;
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    return judgePlan(planPath, { ledgerPath, judgeModel, endpoint, base, usageFile });
  }

  if (command === "eval") {
    const planPath = subcommand;
    if (planPath === undefined || planPath === "" || planPath.startsWith("--")) {
      console.error(USAGE);
      return 2;
    }

    let ledgerPath: string | undefined;
    let check = false;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--ledger") {
        const value = rest[i + 1];
        if (value === undefined || value === "") {
          console.error(USAGE);
          return 2;
        }
        ledgerPath = value;
        i++;
      } else if (arg === "--check") {
        check = true;
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    return evalPlan(planPath, { ledgerPath, check });
  }

  if (command === "examples") {
    const planPath = subcommand;
    if (planPath === undefined || planPath === "" || planPath.startsWith("--")) {
      console.error(USAGE);
      return 2;
    }

    let from: string | undefined;

    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i];
      if (arg === "--from") {
        const value = rest[i + 1];
        if (value === undefined || value === "" || value.startsWith("--")) {
          console.error(USAGE);
          return 2;
        }
        from = value;
        i++;
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    if (from === undefined) {
      console.error(USAGE);
      return 2;
    }

    return examplesPlan(planPath, { from });
  }

  if (command === "install") {
    const modes = new Set<string>();
    let home: string | undefined;
    let manifestPath: string | undefined;
    let only: string | undefined;

    // O primeiro argumento cai em `subcommand`; o modo pode estar em
    // qualquer posição.
    const args = [subcommand, ...rest].filter((a) => a !== undefined);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--dry-run" || arg === "--apply" || arg === "--revert") {
        modes.add(arg);
      } else if (arg === "--home" || arg === "--manifest" || arg === "--only") {
        const value = args[i + 1];
        if (value === undefined || value === "") {
          console.error(USAGE);
          return 2;
        }
        i++;
        if (arg === "--home") home = value;
        else if (arg === "--manifest") manifestPath = value;
        else only = value;
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    if (modes.size !== 1) {
      console.error(USAGE);
      return 2;
    }

    const resolvedHome = home ?? process.env.HOME;
    if (resolvedHome === undefined || !existsSync(resolvedHome)) {
      console.error(USAGE);
      return 2;
    }

    const mode = modes.has("--dry-run")
      ? ("dry-run" as const)
      : modes.has("--apply")
        ? ("apply" as const)
        : ("revert" as const);
    return installCmd({
      mode,
      home: resolvedHome,
      manifestPath,
      only: only as Harness | undefined,
      env: process.env,
    });
  }

  if (command === "adopt") {
    const modes = new Set<string>();
    let home: string | undefined;
    let manifestPath: string | undefined;

    const args = [subcommand, ...rest].filter((a) => a !== undefined);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--dry-run" || arg === "--apply") {
        modes.add(arg);
      } else if (arg === "--home" || arg === "--manifest") {
        const value = args[i + 1];
        if (value === undefined || value === "") {
          console.error(USAGE);
          return 2;
        }
        i++;
        if (arg === "--home") home = value;
        else manifestPath = value;
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    if (modes.size !== 1) {
      console.error(USAGE);
      return 2;
    }

    const resolvedHome = home ?? process.env.HOME;
    if (resolvedHome === undefined || !existsSync(resolvedHome)) {
      console.error(USAGE);
      return 2;
    }

    const env = process.env;
    const resolvedManifest = manifestPath ?? defaultManifestPath(env);

    const apply = modes.has("--apply");
    await adoptLocalEntries({
      homeDir: resolvedHome,
      manifestPath: resolvedManifest,
      apply,
    });
    return 0;
  }

  if (command === "doctor") {
    let json = false;
    let only: string | undefined;
    let endpoint: string | undefined;
    let home: string | undefined;
    let manifestPath: string | undefined;

    const valueFlags = new Set([
      "--only",
      "--endpoint",
      "--home",
      "--manifest",
    ]);

    // O primeiro argumento cai em `subcommand`; flags podem estar em
    // qualquer posição.
    const args = [subcommand, ...rest].filter((a) => a !== undefined);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--json") {
        json = true;
      } else if (valueFlags.has(arg)) {
        const value = args[i + 1];
        if (value === undefined || value === "") {
          console.error(USAGE);
          return 2;
        }
        i++;
        if (arg === "--only") only = value;
        else if (arg === "--endpoint") endpoint = value;
        else if (arg === "--home") home = value;
        else manifestPath = value;
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    if (
      only !== undefined &&
      !(ADAPTER_ORDER as readonly string[]).includes(only) &&
      only !== "llm" &&
      only !== "manifest"
    ) {
      console.error(USAGE);
      return 2;
    }

    const resolvedHome = home ?? process.env.HOME;
    if (resolvedHome === undefined || resolvedHome === "") {
      console.error(USAGE);
      return 2;
    }

    return doctorCmd({
      json,
      only,
      endpoint,
      home: resolvedHome,
      manifestPath,
      env: process.env,
    });
  }

  if (command === "learn") {
    if (subcommand === "ingest") {
      let ledger: string | undefined;
      let evals: string | undefined;
      let sessions: string | undefined;
      let db: string | undefined;
      let repo: string | undefined;
      let denylist: string | undefined;
      let piDir: string | undefined;
      let opencodeDb: string | undefined;
      let hermesDb: string | undefined;
      let frictionFile: string | undefined;

      const valueFlags = new Set([
        "--ledger",
        "--evals",
        "--sessions",
        "--db",
        "--repo",
        "--denylist",
        "--pi",
        "--opencode",
        "--hermes",
        "--friction",
      ]);

      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (valueFlags.has(arg)) {
          const value = rest[i + 1];
          if (value === undefined || value === "") {
            console.error(USAGE);
            return 2;
          }
          i++;
          if (arg === "--ledger") ledger = value;
          else if (arg === "--evals") evals = value;
          else if (arg === "--sessions") sessions = value;
          else if (arg === "--db") db = value;
          else if (arg === "--repo") repo = value;
          else if (arg === "--pi") piDir = value;
          else if (arg === "--opencode") opencodeDb = value;
          else if (arg === "--hermes") hermesDb = value;
          else if (arg === "--friction") frictionFile = value;
          else denylist = value;
        } else {
          console.error(USAGE);
          return 2;
        }
      }

      const hasMulti =
        piDir !== undefined ||
        opencodeDb !== undefined ||
        hermesDb !== undefined ||
        frictionFile !== undefined;

      if (
        ledger === undefined &&
        evals === undefined &&
        sessions === undefined &&
        !hasMulti
      ) {
        console.error(USAGE);
        return 2;
      }

      if (hasMulti) {
        return learnIngestMulti({
          dbPath: db ?? defaultLearnDbPath(process.env),
          piDir,
          opencodeDb,
          hermesDb,
          frictionFile,
        });
      }

      return ingest({
        db: db ?? defaultLearnDbPath(process.env),
        ledger,
        evals,
        sessions,
        repo,
        denylist,
        env: process.env,
      }).exit;
    }

    if (subcommand === "scan") {
      return learnScan(rest);
    }

    if (subcommand === "propose") {
      let db: string | undefined;
      let out: string | undefined;
      let judgeModel: string | undefined;
      let judgeEndpoint: string | undefined;

      const valueFlags = new Set([
        "--db",
        "--out",
        "--judge-model",
        "--judge-endpoint",
      ]);

      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (valueFlags.has(arg)) {
          const value = rest[i + 1];
          if (
            value === undefined ||
            value === "" ||
            value.startsWith("--")
          ) {
            console.error(USAGE);
            return 2;
          }
          i++;
          if (arg === "--db") db = value;
          else if (arg === "--out") out = value;
          else if (arg === "--judge-model") judgeModel = value;
          else judgeEndpoint = value;
        } else {
          console.error(USAGE);
          return 2;
        }
      }

      return proposeCmd({
        db,
        out,
        judgeModel,
        judgeEndpoint,
        env: process.env,
      });
    }

    if (subcommand === "promote") {
      let proposals: string | undefined;
      let id: string | undefined;
      let to: string | undefined;
      let by: string | undefined;

      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--id" || arg === "--to" || arg === "--by") {
          const value = rest[i + 1];
          if (
            value === undefined ||
            value === "" ||
            value.startsWith("--")
          ) {
            console.error(USAGE);
            return 2;
          }
          i++;
          if (arg === "--id") id = value;
          else if (arg === "--to") to = value;
          else by = value;
        } else if (arg.startsWith("--")) {
          console.error(USAGE);
          return 2;
        } else if (proposals === undefined) {
          proposals = arg;
        } else {
          console.error(USAGE);
          return 2;
        }
      }

      if (proposals === undefined || id === undefined || to === undefined) {
        console.error(USAGE);
        return 2;
      }

      return promoteCmd({ proposals, id, to, by, env: process.env });
    }

    if (subcommand === "audit") {
      let dbPath: string | undefined;
      let repoPath: string | undefined;
      let sampleSize: number | undefined;
      let threshold: number | undefined;
      let json = false;

      const valueFlags = new Set([
        "--db",
        "--repo",
        "--sample",
        "--sample-size",
        "--threshold",
      ]);

      for (let i = 0; i < rest.length; i++) {
        const arg = rest[i];
        if (arg === "--json") {
          json = true;
        } else if (valueFlags.has(arg)) {
          const value = rest[i + 1];
          if (
            value === undefined ||
            value === "" ||
            value.startsWith("--")
          ) {
            console.error(USAGE);
            return 2;
          }
          i++;
          if (arg === "--db") dbPath = value;
          else if (arg === "--repo") repoPath = value;
          else if (arg === "--sample" || arg === "--sample-size") {
            const parsed = parseInt(value, 10);
            if (Number.isNaN(parsed) || parsed < 0) {
              console.error(USAGE);
              return 2;
            }
            sampleSize = parsed;
          } else if (arg === "--threshold") {
            const parsed = parseFloat(value);
            if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
              console.error(USAGE);
              return 2;
            }
            threshold = parsed;
          }
        } else {
          console.error(USAGE);
          return 2;
        }
      }

      const resolvedDb = dbPath ?? defaultLearnDbPath(process.env);
      if (!existsSync(resolvedDb)) {
        console.error(`learn audit: banco não encontrado: ${resolvedDb}`);
        return LEARN_EXIT.infra;
      }

      let db;
      try {
        db = openLearnDb(resolvedDb);
      } catch (err) {
        console.error(`learn audit: banco ilegível: ${(err as Error).message}`);
        return LEARN_EXIT.infra;
      }

      try {
        const noVerify = await auditNoVerify(db, repoPath);
        const precision = evaluateLessonsPrecision(db, {
          sampleSize,
          threshold,
        });

        if (json) {
          console.log(
            JSON.stringify({
              no_verify: noVerify,
              precision,
              no_verify_audit: noVerify,
              lessons_precision: precision,
            })
          );
        } else {
          console.log(
            `no-verify: flagged=${noVerify.tool_calls_flagged} bypassed=${noVerify.git_commits_bypassed} clean_ratio=${noVerify.clean_ratio}`
          );
          console.log(
            `lessons precision: ${precision.useful_count}/${precision.sample_size} (${(precision.precision_ratio * 100).toFixed(1)}%) gate=${precision.passes_gate ? "PASS" : "FAIL"}`
          );
        }
        return 0;
      } finally {
        db.close();
      }
    }

    console.error(USAGE);
    return 2;
  }

  if (command === "precommit") {
    const sep = argv.indexOf("--");
    const cmd =
      sep !== -1
        ? argv.slice(sep + 1)
        : argv.filter((arg) => arg !== "precommit");
    if (cmd.length === 0) cmd.push("bun", "test");

    const staged = Bun.spawnSync(
      ["git", "diff", "--cached", "--name-only"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const stagedList =
      staged.exitCode === 0
        ? staged.stdout.toString().split("\n").filter((l) => l.length > 0)
        : [];

    if (precommitDecision(stagedList) === "skip") {
      console.log("precommit: só tests/, tasks/ e specs/ staged; suíte pulada");
      return 0;
    }

    const res = Bun.spawnSync(cmd, {
      cwd: process.cwd(),
      stdio: ["inherit", "inherit", "inherit"],
      env: cleanGitEnv(),
    });
    return res.exitCode ?? 1;
  }

  if (command === "maestro") {
    const sub = argv[1];
    if (sub === "scoreboard") {
      let ledgerPath: string | undefined;
      let dbPath: string | undefined;
      let json = false;
      for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--ledger") {
          ledgerPath = argv[++i];
        } else if (arg === "--db") {
          dbPath = argv[++i];
        } else if (arg === "--json") {
          json = true;
        }
      }
      const scoreboard = await computeWorkerScoreboard(ledgerPath, dbPath);
      if (json) {
        console.log(JSON.stringify(scoreboard, null, 2));
      } else {
        console.log(formatMaestroDigest(scoreboard, []));
      }
      return 0;
    }

    if (sub === "recommend") {
      let planPath: string | undefined;
      let ledgerPath: string | undefined;
      let dbPath: string | undefined;
      let json = false;
      for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--ledger") {
          ledgerPath = argv[++i];
        } else if (arg === "--db") {
          dbPath = argv[++i];
        } else if (arg === "--json") {
          json = true;
        } else if (!arg.startsWith("--") && !planPath) {
          planPath = arg;
        }
      }
      if (!planPath) {
        console.error(USAGE);
        return 2;
      }
      const scoreboard = await computeWorkerScoreboard(ledgerPath, dbPath);
      const rec = recommendOrchestration(planPath, scoreboard);
      if (json) {
        console.log(JSON.stringify(rec, null, 2));
      } else {
        console.log(`Recomendação Maestro:`);
        console.log(`- Topologia: ${rec.topology}`);
        console.log(`- Operário: ${rec.recommended_worker ?? "nenhum"}`);
        console.log(`- Motivo: ${rec.reason}`);
      }
      return 0;
    }

    if (sub === "envelope") {
      let planPath: string | undefined;
      let ledgerPath: string | undefined;
      let json = false;
      for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--ledger") {
          ledgerPath = argv[++i];
        } else if (arg === "--json") {
          json = true;
        } else if (!arg.startsWith("--") && !planPath) {
          planPath = arg;
        }
      }
      if (!planPath) {
        console.error(USAGE);
        return 2;
      }
      const envelope = createTaskRequest(planPath);
      console.log(JSON.stringify(envelope, null, 2));
      return 0;
    }

    if (sub === "digest") {
      let ledgerPath: string | undefined;
      let dbPath: string | undefined;
      let json = false;
      let send = false;
      for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--ledger") {
          ledgerPath = argv[++i];
        } else if (arg === "--db") {
          dbPath = argv[++i];
        } else if (arg === "--json") {
          json = true;
        } else if (arg === "--send") {
          send = true;
        }
      }
      const scoreboard = await computeWorkerScoreboard(ledgerPath, dbPath);
      const digest = formatMaestroDigest(scoreboard, []);
      if (json) {
        console.log(JSON.stringify({ scoreboard, digest }, null, 2));
      } else {
        console.log(digest);
      }
      return 0;
    }

    console.error(USAGE);
    return 2;
  }

  console.error(USAGE);
  return 2;
}
