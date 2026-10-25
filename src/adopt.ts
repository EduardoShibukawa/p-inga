import { existsSync, lstatSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Harness, Manifest } from "./manifest";
import { backupFile, readManifest, writeAtomic } from "./manifest";

export type AdoptableTarget = {
  harness: "claude" | "opencode" | "pi";
  target_file: string;
  key_path?: string;
  kind: "json_entry" | "file" | "symlink";
  status: "adoptable" | "broken_symlink" | "already_owned" | "missing";
};

export type AdoptResult = {
  inspected: number;
  adopted: number;
  cleaned: number;
  skipped: number;
  backups_created: string[];
};

export function classifyAdoptTarget(input: {
  target: string;
  exists: boolean;
  is_owned: boolean;
  is_broken_symlink: boolean;
}): "adoptable" | "broken_symlink" | "already_owned" | "missing" | "ignored" {
  if (input.is_owned) return "already_owned";
  if (input.is_broken_symlink) return "broken_symlink";
  if (!input.exists) return "missing";
  const t = input.target.toLowerCase();
  if (
    t.includes("claude") ||
    t.includes("opencode") ||
    t.includes("pi") ||
    t.includes("hermes") ||
    t.includes("tuios")
  ) {
    return "adoptable";
  }
  return "ignored";
}

export async function inspectAdoptableEntries(
  homeDir: string,
  manifestPath: string,
): Promise<AdoptableTarget[]> {
  let manifest: Manifest;
  try {
    manifest = readManifest(manifestPath);
  } catch {
    manifest = { version: 1, entries: [] };
  }

  const isOwned = (targetFile: string, keyPath?: string): boolean => {
    return manifest.entries.some((e) => {
      if (e.target_file !== targetFile) return false;
      if (keyPath !== undefined) {
        return e.key_path === keyPath;
      }
      return e.key_path === undefined || e.key_path === "";
    });
  };

  const results: AdoptableTarget[] = [];
  const seen = new Set<string>();

  const addTarget = (t: AdoptableTarget) => {
    const key = `${t.target_file}::${t.key_path ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(t);
  };

  // 1. .claude/settings.json
  const settingsRel = ".claude/settings.json";
  const settingsAbs = join(homeDir, settingsRel);
  if (existsSync(settingsAbs)) {
    try {
      const doc = JSON.parse(readFileSync(settingsAbs, "utf8")) as Record<string, unknown>;
      if (
        doc.enabledPlugins &&
        typeof doc.enabledPlugins === "object" &&
        !Array.isArray(doc.enabledPlugins) &&
        "pi-harness@pi-harness-local" in (doc.enabledPlugins as Record<string, unknown>)
      ) {
        const keyPath = "/enabledPlugins/pi-harness@pi-harness-local";
        const owned = isOwned(settingsRel, keyPath);
        const status = classifyAdoptTarget({
          target: "claude-settings",
          exists: true,
          is_owned: owned,
          is_broken_symlink: false,
        });
        if (status !== "ignored") {
          addTarget({
            harness: "claude",
            target_file: settingsRel,
            key_path: keyPath,
            kind: "json_entry",
            status: status as AdoptableTarget["status"],
          });
        }
      }
    } catch {
      // ignore parse error
    }
  }

  // 2. .claude/plugins/installed_plugins.json
  const ipRel = ".claude/plugins/installed_plugins.json";
  const ipAbs = join(homeDir, ipRel);
  if (existsSync(ipAbs)) {
    try {
      const doc = JSON.parse(readFileSync(ipAbs, "utf8")) as Record<string, unknown>;
      if (
        doc.plugins &&
        typeof doc.plugins === "object" &&
        !Array.isArray(doc.plugins) &&
        "pi-harness@pi-harness-local" in (doc.plugins as Record<string, unknown>)
      ) {
        const keyPath = "/plugins/pi-harness@pi-harness-local";
        const owned = isOwned(ipRel, keyPath);
        const status = classifyAdoptTarget({
          target: "claude-installed-plugins",
          exists: true,
          is_owned: owned,
          is_broken_symlink: false,
        });
        if (status !== "ignored") {
          addTarget({
            harness: "claude",
            target_file: ipRel,
            key_path: keyPath,
            kind: "json_entry",
            status: status as AdoptableTarget["status"],
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. .claude/plugins/known_marketplaces.json
  const kmRel = ".claude/plugins/known_marketplaces.json";
  const kmAbs = join(homeDir, kmRel);
  if (existsSync(kmAbs)) {
    try {
      const doc = JSON.parse(readFileSync(kmAbs, "utf8")) as Record<string, unknown>;
      if (
        doc &&
        typeof doc === "object" &&
        !Array.isArray(doc) &&
        "pi-harness-local" in doc
      ) {
        const keyPath = "/pi-harness-local";
        const owned = isOwned(kmRel, keyPath);
        const status = classifyAdoptTarget({
          target: "claude-known-marketplaces",
          exists: true,
          is_owned: owned,
          is_broken_symlink: false,
        });
        if (status !== "ignored") {
          addTarget({
            harness: "claude",
            target_file: kmRel,
            key_path: keyPath,
            kind: "json_entry",
            status: status as AdoptableTarget["status"],
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. .claude/plugins/local
  const localRel = ".claude/plugins/local";
  const localAbs = join(homeDir, localRel);
  let localExists = false;
  let localBroken = false;
  try {
    const st = lstatSync(localAbs);
    if (st.isSymbolicLink()) {
      if (existsSync(localAbs)) localExists = true;
      else localBroken = true;
    } else {
      localExists = true;
    }
  } catch {
    // not present
  }
  if (localExists || localBroken) {
    const owned = isOwned(localRel);
    const status = classifyAdoptTarget({
      target: "claude-plugins-local",
      exists: localExists,
      is_owned: owned,
      is_broken_symlink: localBroken,
    });
    if (status !== "ignored") {
      addTarget({
        harness: "claude",
        target_file: localRel,
        kind: "symlink",
        status: status as AdoptableTarget["status"],
      });
    }
  }

  // 5. .config/opencode/plugins/pi-harness.js
  const ocJsRel = ".config/opencode/plugins/pi-harness.js";
  const ocJsAbs = join(homeDir, ocJsRel);
  let ocJsExists = false;
  let ocJsBroken = false;
  let ocJsSym = false;
  try {
    const st = lstatSync(ocJsAbs);
    ocJsSym = st.isSymbolicLink();
    if (ocJsSym) {
      if (existsSync(ocJsAbs)) ocJsExists = true;
      else ocJsBroken = true;
    } else {
      ocJsExists = true;
    }
  } catch {
    // not present
  }
  if (ocJsExists || ocJsBroken) {
    const owned = isOwned(ocJsRel);
    const status = classifyAdoptTarget({
      target: "opencode-local",
      exists: ocJsExists,
      is_owned: owned,
      is_broken_symlink: ocJsBroken,
    });
    if (status !== "ignored") {
      addTarget({
        harness: "opencode",
        target_file: ocJsRel,
        kind: ocJsSym ? "symlink" : "file",
        status: status as AdoptableTarget["status"],
      });
    }
  }

  // 6. .config/opencode/plugins directory scan
  const ocPluginsDir = join(homeDir, ".config/opencode/plugins");
  if (existsSync(ocPluginsDir)) {
    try {
      const entries = readdirSync(ocPluginsDir);
      for (const name of entries) {
        if (name === "pi-harness.js") continue; // handled in #5
        const rel = `.config/opencode/plugins/${name}`;
        const abs = join(homeDir, rel);
        let exists = false;
        let broken = false;
        let isSym = false;
        try {
          const st = lstatSync(abs);
          isSym = st.isSymbolicLink();
          if (isSym) {
            if (existsSync(abs)) exists = true;
            else broken = true;
          } else {
            exists = true;
          }
        } catch {
          continue;
        }

        if (broken || name.startsWith("pi-harness")) {
          const owned = isOwned(rel);
          const status = classifyAdoptTarget({
            target: `opencode-${name}`,
            exists,
            is_owned: owned,
            is_broken_symlink: broken,
          });
          if (status !== "ignored") {
            addTarget({
              harness: "opencode",
              target_file: rel,
              kind: isSym ? "symlink" : "file",
              status: status as AdoptableTarget["status"],
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 7. .pi/agent/extensions/pi-harness.ts
  const piExtRel = ".pi/agent/extensions/pi-harness.ts";
  const piExtAbs = join(homeDir, piExtRel);
  let piExtExists = false;
  let piExtBroken = false;
  let piExtSym = false;
  try {
    const st = lstatSync(piExtAbs);
    piExtSym = st.isSymbolicLink();
    if (piExtSym) {
      if (existsSync(piExtAbs)) piExtExists = true;
      else piExtBroken = true;
    } else {
      piExtExists = true;
    }
  } catch {
    // not present
  }
  if (piExtExists || piExtBroken) {
    const owned = isOwned(piExtRel);
    const status = classifyAdoptTarget({
      target: "pi-symlink",
      exists: piExtExists,
      is_owned: owned,
      is_broken_symlink: piExtBroken,
    });
    if (status !== "ignored") {
      addTarget({
        harness: "pi",
        target_file: piExtRel,
        kind: piExtSym ? "symlink" : "file",
        status: status as AdoptableTarget["status"],
      });
    }
  }

  // Also scan .pi/agent/extensions for other broken symlinks or pi-harness* entries
  const piExtDir = join(homeDir, ".pi/agent/extensions");
  if (existsSync(piExtDir)) {
    try {
      const entries = readdirSync(piExtDir);
      for (const name of entries) {
        if (name === "pi-harness.ts") continue;
        const rel = `.pi/agent/extensions/${name}`;
        const abs = join(homeDir, rel);
        let exists = false;
        let broken = false;
        let isSym = false;
        try {
          const st = lstatSync(abs);
          isSym = st.isSymbolicLink();
          if (isSym) {
            if (existsSync(abs)) exists = true;
            else broken = true;
          } else {
            exists = true;
          }
        } catch {
          continue;
        }

        if (broken || name.startsWith("pi-harness")) {
          const owned = isOwned(rel);
          const status = classifyAdoptTarget({
            target: `pi-${name}`,
            exists,
            is_owned: owned,
            is_broken_symlink: broken,
          });
          if (status !== "ignored") {
            addTarget({
              harness: "pi",
              target_file: rel,
              kind: isSym ? "symlink" : "file",
              status: status as AdoptableTarget["status"],
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Also scan .pi/agent/skills for broken symlinks
  const piSkillsDir = join(homeDir, ".pi/agent/skills");
  if (existsSync(piSkillsDir)) {
    try {
      const entries = readdirSync(piSkillsDir);
      for (const name of entries) {
        const rel = `.pi/agent/skills/${name}`;
        const abs = join(homeDir, rel);
        let exists = false;
        let broken = false;
        let isSym = false;
        try {
          const st = lstatSync(abs);
          isSym = st.isSymbolicLink();
          if (isSym) {
            if (existsSync(abs)) exists = true;
            else broken = true;
          } else {
            exists = true;
          }
        } catch {
          continue;
        }

        if (broken || name.startsWith("pi-harness")) {
          const owned = isOwned(rel);
          const status = classifyAdoptTarget({
            target: `pi-${name}`,
            exists,
            is_owned: owned,
            is_broken_symlink: broken,
          });
          if (status !== "ignored") {
            addTarget({
              harness: "pi",
              target_file: rel,
              kind: isSym ? "symlink" : "file",
              status: status as AdoptableTarget["status"],
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return results;
}

export async function adoptLocalEntries(opts: {
  homeDir: string;
  manifestPath: string;
  apply?: boolean;
}): Promise<AdoptResult> {
  const targets = await inspectAdoptableEntries(opts.homeDir, opts.manifestPath);

  const inspected = targets.filter(
    (t) => t.status !== "missing",
  ).length;
  const adoptableList = targets.filter((t) => t.status === "adoptable");
  const brokenList = targets.filter((t) => t.status === "broken_symlink");
  const skippedList = targets.filter((t) => t.status === "already_owned");

  const adopted = adoptableList.length;
  const cleaned = brokenList.length;
  const skipped = skippedList.length;
  const backups_created: string[] = [];

  if (opts.apply && (adopted > 0 || cleaned > 0)) {
    const stateDir = dirname(opts.manifestPath);
    let manifest: Manifest;
    try {
      manifest = readManifest(opts.manifestPath);
    } catch {
      manifest = { version: 1, entries: [] };
    }

    const now = new Date().toISOString();

    // Clean broken symlinks
    for (const t of brokenList) {
      const abs = join(opts.homeDir, t.target_file);
      try {
        const backup = backupFile(stateDir, abs);
        if (!backups_created.includes(backup.backup_path)) {
          backups_created.push(backup.backup_path);
        }
      } catch {
        // if backup fails, proceed
      }
      try {
        unlinkSync(abs);
      } catch {
        // ignore
      }
    }

    // Adopt adoptable entries
    for (const t of adoptableList) {
      const abs = join(opts.homeDir, t.target_file);
      const backup = backupFile(stateDir, abs);
      if (!backups_created.includes(backup.backup_path)) {
        backups_created.push(backup.backup_path);
      }

      // Upsert into manifest.entries
      for (let i = manifest.entries.length - 1; i >= 0; i--) {
        const e = manifest.entries[i]!;
        if (
          e.harness === t.harness &&
          e.target_file === t.target_file &&
          (e.key_path ?? undefined) === (t.key_path ?? undefined)
        ) {
          manifest.entries.splice(i, 1);
        }
      }

      manifest.entries.push({
        harness: t.harness as Harness,
        target_file: t.target_file,
        ...(t.key_path !== undefined ? { key_path: t.key_path } : {}),
        sha256_pre: backup.sha256,
        sha256_post: backup.sha256,
        installed_at: now,
        backup_path: backup.backup_path,
        adopted: true,
      });
    }

    if (manifest.entries.length > 0) {
      writeAtomic(
        opts.manifestPath,
        JSON.stringify(manifest, null, 2) + "\n",
      );
    }
  }

  return {
    inspected,
    adopted,
    cleaned,
    skipped,
    backups_created,
  };
}
