import type { Adapter, AdapterContext, Probe } from "../install";
import { installTimeoutMs, nativeFailError, runNative } from "../shadow";

export const TUIOS_CONFIGS = [
  ".claude/settings.json",
  ".hermes/config.yaml",
];
export const TUIOS_BACKUPS = [
  ".claude/settings.json.tuios.bak",
  ".hermes/config.yaml.tuios.bak",
];

export const TUIOS_INSTALL_ARGS = [
  "integration",
  "install",
  "claude-code",
  "opencode",
  "pi",
  "hermes",
];

export const tuiosProbe: Probe = {
  check: "integration_status",
  cmd: () => ["integration", "status"],
  classify: (r: { exit: number; stdout: string }) => {
    if (r.exit !== 0) {
      return { status: "broken", detail: `integration status exit ${r.exit}` };
    }
    const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.some((l) => l.includes("not installed"))) {
      return {
        status: "degraded",
        detail: "integração não instalada em alguma parte",
      };
    }
    if (lines.every((l) => l.includes("installed") || l.includes("current"))) {
      return { status: "ok", detail: "integrações instaladas" };
    }
    return {
      status: "degraded",
      detail: "integração com status desconhecido",
    };
  },
};

export const tuiosAdapter: Adapter = {
  harness: "tuios",
  bin: "tuios",
  targets: [...TUIOS_CONFIGS, ...TUIOS_BACKUPS],
  owned: {},
  volatile: {},
  append: {
    ".claude/settings.json": ["/hooks"],
    ".hermes/config.yaml": ["/hooks"],
  },
  probes: [tuiosProbe],

  apply(
    shadowHome: string,
    _ctx: AdapterContext,
    env?: Record<string, string | undefined>,
  ): void {
    const e = env ?? process.env;
    const res = runNative(
      "tuios",
      TUIOS_INSTALL_ARGS,
      shadowHome,
      e,
      installTimeoutMs(e),
    );
    if (res.exit !== 0) {
      throw nativeFailError("tuios", TUIOS_INSTALL_ARGS, res.exit);
    }
  },
};
