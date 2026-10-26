import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Receipt } from "./receipt";

export interface DiscordConfig {
  token: string;
  channelId: string;
}

/**
 * Resolves Discord configuration from environment variables or Hermes configuration files.
 */
export function resolveDiscordConfig(): DiscordConfig | null {
  let token = process.env.DISCORD_BOT_TOKEN;
  let channelId = process.env.DISCORD_CHANNEL_ID;

  // Check ~/.hermes/profiles/pinga/.env
  const pingaEnvPath = join(homedir(), ".hermes", "profiles", "pinga", ".env");
  if (!token && existsSync(pingaEnvPath)) {
    try {
      const content = readFileSync(pingaEnvPath, "utf8");
      const match = content.match(/DISCORD_BOT_TOKEN=([^\r\n]+)/);
      if (match && match[1]) {
        token = match[1].trim();
      }
    } catch {}
  }

  // Check ~/.hermes/.env
  const hermesEnvPath = join(homedir(), ".hermes", ".env");
  if (!token && existsSync(hermesEnvPath)) {
    try {
      const content = readFileSync(hermesEnvPath, "utf8");
      const match = content.match(/DISCORD_BOT_TOKEN=([^\r\n]+)/);
      if (match && match[1]) {
        token = match[1].trim();
      }
    } catch {}
  }

  // Resolve channelId from ~/.hermes/profiles/pinga/config.yaml
  if (!channelId) {
    const pingaConfigPath = join(homedir(), ".hermes", "profiles", "pinga", "config.yaml");
    if (existsSync(pingaConfigPath)) {
      try {
        const content = readFileSync(pingaConfigPath, "utf8");
        const match = content.match(/chat_id:\s*['"]?([0-9]+)['"]?/);
        if (match && match[1]) {
          channelId = match[1].trim();
        }
      } catch {}
    }
  }

  // Default homelab Discord notification channel (#hermes)
  if (!channelId) {
    channelId = "1563272747591803110";
  }

  if (!token) {
    return null;
  }

  return { token, channelId };
}

/**
 * Dispatches a message and optional embed to Discord via Discord REST API v10.
 */
export async function sendDiscordMessage(
  content: string,
  embed?: Record<string, any>,
  configOverride?: DiscordConfig,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const cfg = configOverride || resolveDiscordConfig();
  if (!cfg) {
    return { ok: false, status: 0, error: "Discord bot token not configured" };
  }

  const payload: Record<string, any> = { content };
  if (embed) {
    payload.embeds = [embed];
  }

  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${cfg.channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, status: res.status, error: errText };
    }

    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
}

/**
 * Formats a verified task Receipt into a rich Discord embed card.
 */
export function formatReceiptDiscordEmbed(receipt: Receipt): Record<string, any> {
  const colors: Record<string, number> = {
    pass: 0x34d399, // Green
    fail: 0xf87171, // Red
    blocked: 0xfbbf24, // Amber
  };

  const statusIcons: Record<string, string> = {
    pass: "🟢 PASS",
    fail: "🔴 FAIL",
    blocked: "🟡 BLOCKED",
  };

  const color = colors[receipt.status] ?? 0x94a3b8;
  const statusStr = statusIcons[receipt.status] ?? receipt.status.toUpperCase();

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: "Task ID", value: `\`${receipt.task_id}\``, inline: true },
    { name: "Status", value: `**${statusStr}**`, inline: true },
    { name: "Attempt", value: `${receipt.attempt}`, inline: true },
  ];

  if (receipt.reason_code) {
    fields.push({ name: "Reason Code", value: `\`${receipt.reason_code}\``, inline: true });
  }

  if (receipt.tokens && receipt.tokens.total != null) {
    fields.push({
      name: "Tokens",
      value: `${receipt.tokens.total.toLocaleString()} (${receipt.tokens.source || "n/a"})`,
      inline: true,
    });
  }

  if (receipt.evidence && receipt.evidence.length > 0) {
    const ev = receipt.evidence[0];
    const exitStr = ev.exit != null ? `exit ${ev.exit}` : "n/a";
    const durationStr = `${ev.duration_ms}ms`;
    fields.push({ name: "Execution", value: `${exitStr} in ${durationStr}`, inline: true });
  }

  return {
    title: `Receipt Sealing: ${receipt.task_id}`,
    description: receipt.summary ? `> ${receipt.summary}` : undefined,
    color,
    fields,
    footer: {
      text: `P-Ingá Ledger • ${new Date().toISOString()}`,
    },
  };
}

/**
 * Notifies Discord of a newly sealed task receipt.
 */
export async function notifyReceipt(receipt: Receipt): Promise<boolean> {
  const embed = formatReceiptDiscordEmbed(receipt);
  const statusIcon = receipt.status === "pass" ? "🟢" : receipt.status === "fail" ? "🔴" : "🟡";
  const content = `${statusIcon} **P-Ingá Task Update**: \`${receipt.task_id}\` completada com status **${receipt.status.toUpperCase()}**`;
  const result = await sendDiscordMessage(content, embed);
  return result.ok;
}

/**
 * Notifies Discord of a Maestro digest summary.
 */
export async function notifyDigest(digest: string): Promise<boolean> {
  const content = `📋 **P-Ingá Maestro Digest**\n\`\`\`text\n${digest.slice(0, 1900)}\n\`\`\``;
  const result = await sendDiscordMessage(content);
  return result.ok;
}
