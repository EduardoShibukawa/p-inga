import type { Adapter, AdapterContext, Probe } from "../install";
import { installTimeoutMs, nativeFailError, runNative } from "../shadow";

export const HERMES_CONFIG = ".hermes/config.yaml";
export const HERMES_PLUGIN_DIR = ".hermes/plugins/pi-harness/";

export const hermesPluginsListProbe: Probe = {
  check: "plugins_list",
  cmd: () => ["plugins", "list"],
  classify: (r: { exit: number; stdout: string }) => {
    if (r.exit !== 0) {
      return { status: "broken", detail: `plugins list exit ${r.exit}` };
    }
    const line = r.stdout
      .split(/\r?\n/)
      .find((l) => l.includes("pi-harness"));
    if (line === undefined) {
      return { status: "degraded", detail: "linha do plugin pi-harness ausente" };
    }
    if (line.includes("enabled") && !line.includes("disabled")) {
      return { status: "ok", detail: "plugin pi-harness habilitado" };
    }
    return { status: "degraded", detail: "plugin pi-harness desabilitado" };
  },
};

export const hermesDoctorProbe: Probe = {
  check: "doctor",
  cmd: () => ["doctor"],
  classify: (r: { exit: number; stdout: string }) => {
    if (r.exit !== 0) {
      return { status: "broken", detail: `hermes doctor exit ${r.exit}` };
    }
    return { status: "ok", detail: "hermes doctor ok" };
  },
};

export const hermesAdapter: Adapter = {
  harness: "hermes",
  bin: "hermes",
  targets: [HERMES_PLUGIN_DIR, HERMES_CONFIG],
  owned: {},
  volatile: {},
  append: { [HERMES_CONFIG]: ["/plugins/enabled"] },
  probes: [hermesPluginsListProbe, hermesDoctorProbe],

  apply(
    shadowHome: string,
    ctx: AdapterContext,
    env?: Record<string, string | undefined>,
  ): void {
    const e = env ?? process.env;
    const timeoutMs = installTimeoutMs(e);

    const install = runNative(
      "hermes",
      ["plugins", "install", ctx.source],
      shadowHome,
      e,
      timeoutMs,
    );
    if (install.exit !== 0) {
      throw nativeFailError(
        "hermes",
        ["plugins", "install", ctx.source],
        install.exit,
      );
    }

    const enable = runNative(
      "hermes",
      ["plugins", "enable", "pi-harness"],
      shadowHome,
      e,
      timeoutMs,
    );
    if (enable.exit !== 0) {
      throw nativeFailError(
        "hermes",
        ["plugins", "enable", "pi-harness"],
        enable.exit,
      );
    }
  },
};
