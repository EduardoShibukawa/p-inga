import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENCODE_HEADER, opencodeProbe } from "../src/adapters/opencode";

const paths = (config: string) => `home       /x\nconfig     ${config}\nstate      /y\n`;

describe("T48 — probe do opencode", () => {
  test("usa `opencode debug paths`", () => {
    expect(opencodeProbe.cmd({ source: "/s" })).toEqual(["debug", "paths"]);
  });
  test("plugin gerado presente → ok", () => {
    const cfg = mkdtempSync(join(tmpdir(), "oc-"));
    mkdirSync(join(cfg, "plugins"));
    writeFileSync(join(cfg, "plugins/pi-harness.ts"), `${OPENCODE_HEADER}\nexport const X = 1;\n`);
    expect(opencodeProbe.classify({ exit: 0, stdout: paths(cfg) }).status).toBe("ok");
  });
  test("plugin ausente → degraded", () => {
    const cfg = mkdtempSync(join(tmpdir(), "oc-"));
    expect(opencodeProbe.classify({ exit: 0, stdout: paths(cfg) }).status).toBe("degraded");
  });
  test("arquivo sem cabeçalho do pinga → degraded", () => {
    const cfg = mkdtempSync(join(tmpdir(), "oc-"));
    mkdirSync(join(cfg, "plugins"));
    writeFileSync(join(cfg, "plugins/pi-harness.ts"), "export const X = 1;\n");
    expect(opencodeProbe.classify({ exit: 0, stdout: paths(cfg) }).status).toBe("degraded");
  });
  test("exit != 0 → broken", () => {
    expect(opencodeProbe.classify({ exit: 2, stdout: "" }).status).toBe("broken");
  });
});
