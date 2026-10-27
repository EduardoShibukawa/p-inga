import type { Adapter, AdapterContext, Probe } from "../install";
import { existsSync, lstatSync, mkdirSync, readlinkSync, statSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { installTimeoutMs, nativeFailError, runNative } from "../shadow";

export const HERMES_CONFIG = ".hermes/config.yaml";
export const HERMES_PLUGIN_DIR = ".hermes/plugins/pi-harness/";
/** Fonte local: o plugin é um symlink (alvo de arquivo, entra no manifesto). */
export const HERMES_PLUGIN_LINK = ".hermes/plugins/pi-harness";

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

function isLocalDir(source: string): boolean {
  try {
    return statSync(source).isDirectory();
  } catch {
    return false;
  }
}

/** Fonte local: `hermes plugins install` só aceita catálogo/Git/owner-repo,
 * então o plugin entra como symlink <shadow>/.hermes/plugins/pi-harness. */
function linkLocalPlugin(shadowHome: string, source: string): void {
  const target = join(resolve(source), "hermes-plugin");
  if (!existsSync(join(target, "plugin.yaml"))) {
    throw new Error(`hermes: fonte local sem ${target}/plugin.yaml`);
  }
  const link = join(shadowHome, HERMES_PLUGIN_LINK);
  let current: string | null = null;
  try {
    const st = lstatSync(link);
    if (!st.isSymbolicLink()) {
      throw new Error(`hermes: ${link} já existe e não é symlink (esperado -> ${target})`);
    }
    current = readlinkSync(link);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (current !== null) {
    if (resolve(dirname(link), current) === target) return;
    throw new Error(`hermes: ${link} aponta para ${current}, esperado ${target}`);
  }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link);
}

export const hermesAdapter: Adapter = {
  harness: "hermes",
  bin: "hermes",
  targets: [HERMES_PLUGIN_DIR, HERMES_PLUGIN_LINK, HERMES_CONFIG],
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

    if (isLocalDir(ctx.source)) {
      linkLocalPlugin(shadowHome, ctx.source);
    } else {
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
