import { mkdirSync, writeFileSync } from "node:fs";

const cwd = process.cwd();

const gitStatus = Bun.spawnSync(["git", "status", "--porcelain"], {
  cwd,
  stdout: "pipe",
  stderr: "pipe",
});

if (gitStatus.exitCode !== 0 || gitStatus.stdout.toString().trim() !== "") {
  console.error("árvore suja");
  process.exit(1);
}

mkdirSync(".pinga", { recursive: true });

const build = Bun.spawnSync(
  ["bun", "build", "--compile", "bin/pinga.ts", "--outfile", ".pinga/pinga-stable"],
  {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  },
);

if (build.exitCode !== 0 || build.exitedDueToTimeout === true) {
  console.error(build.stderr.toString());
  process.exit(1);
}

const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
  cwd,
  stdout: "pipe",
  stderr: "pipe",
});

if (head.exitCode !== 0) {
  console.error(head.stderr.toString());
  process.exit(1);
}

const commit = head.stdout.toString().trim();
const stable = {
  commit,
  builtAt: new Date().toISOString(),
};

writeFileSync(".pinga/stable.json", `${JSON.stringify(stable, null, 2)}\n`);
