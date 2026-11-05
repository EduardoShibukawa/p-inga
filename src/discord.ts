import type { Receipt } from "./receipt";

export interface DiscordConfig {
  token: string;
  channelId: string;
}

/**
 * Resolves Discord configuration from the environment only (A4 — PLAN-0010
 * TASK-06): `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID`, sem canal padrão
 * fixo: faltando qualquer um dos dois → `null`.
 */
export function resolveDiscordConfig(): DiscordConfig | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
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
