import type { Adapter, AdapterContext, Probe } from "../install";
import { installTimeoutMs, nativeFailError, runNative } from "../shadow";

export const piProbe: Probe = {
  check: "global_status",
  cmd: () => ["global", "status", "--json"],
  classify: (r: { exit: number; stdout: string }) => {
    if (r.exit !== 0) {
      return { status: "broken", detail: `global status exit ${r.exit}` };
    }
    try {
      JSON.parse(r.stdout);
      return { status: "ok", detail: "skills instaladas" };
    } catch {
      return { status: "degraded", detail: "JSON inválido em global status" };
    }
  },
};

export const piAdapter: Adapter = {
  harness: "pi",
  bin: "pi-harness",
  targets: [".pi/agent/skills/", ".pi/agent/extensions/"],
  owned: {},
  volatile: {},
  probes: [piProbe],

  apply(
    shadowHome: string,
    ctx: AdapterContext,
    env?: Record<string, string | undefined>,
  ): void {
    const e = env ?? process.env;
    const res = runNative(
      "pi-harness",
      ["global", "install"],
      shadowHome,
      e,
      installTimeoutMs(e),
    );
    if (res.exit !== 0) {
      throw nativeFailError("pi-harness", ["global", "install"], res.exit);
    }
  },
};
