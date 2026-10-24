import { defaultLedgerPath, openLedger } from "./ledger";
import { verifyPlan } from "./verify";

const USAGE = `usage: pinga ledger verify [--ledger PATH]
       pinga verify <PLAN.md> [--ledger PATH] [--attempt N]`;

export function runCli(argv: string[]): number {
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
      } else {
        console.error(USAGE);
        return 2;
      }
    }

    return verifyPlan(planPath, ledgerPath, attempt);
  }

  console.error(USAGE);
  return 2;
}
