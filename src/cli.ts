import { defaultLedgerPath, openLedger } from "./ledger";

const USAGE = "usage: pinga ledger verify [--ledger PATH]";

export function runCli(argv: string[]): number {
  const [command, subcommand, ...rest] = argv;

  if (command !== "ledger" || subcommand !== "verify") {
    console.error(USAGE);
    return 2;
  }

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
