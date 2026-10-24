import { evalPlan } from "./eval";
import { examplesPlan } from "./examples";
import { judgePlan } from "./judge";
import { modePlan } from "./mode";
import { precommitDecision } from "./guards";
import { defaultLedgerPath, openLedger } from "./ledger";
import { provePlan } from "./prove";
import { verifyPlan } from "./verify";

const USAGE = `usage: pinga ledger verify [--ledger PATH]
       pinga verify <PLAN.md> [--ledger PATH] [--attempt N] [--base SHA] [--usage-file PATH] [--override-mode M --reason TEXTO] [--prove-base]
       pinga prove-red <PLAN.md> [--ledger PATH] [--base SHA]
       pinga mode <PLAN.md> [--base SHA] [--override-mode M --reason TEXTO]
       pinga judge <PLAN.md> [--ledger PATH] [--judge-model M] [--endpoint URL] [--base SHA] [--usage-file PATH]
       pinga eval <PLAN.md> [--ledger PATH] [--check]
       pinga examples <PLAN.md> --from PATH
       pinga precommit [-- <cmd...>]`;

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

export function runCli(argv: string[]): number | Promise<number> {
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

  console.error(USAGE);
  return 2;
}
