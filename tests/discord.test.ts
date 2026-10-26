import { describe, expect, it } from "bun:test";
import {
  formatReceiptDiscordEmbed,
  resolveDiscordConfig,
  sendDiscordMessage,
} from "../src/discord";
import type { Receipt } from "../src/receipt";

describe("T26 — Discord Notifications & Remote Observability (P-Ingá v0.7)", () => {
  it("1. resolveDiscordConfig resolves token and channel from Hermes config or fallback", () => {
    const cfg = resolveDiscordConfig();
    expect(cfg).not.toBeNull();
    if (cfg) {
      expect(cfg.token.length).toBeGreaterThan(10);
      expect(cfg.channelId).toBe("1563272747591803110");
    }
  });

  it("2. formatReceiptDiscordEmbed structures rich Discord embed with status colors", () => {
    const mockReceipt: Receipt = {
      v: 1,
      type: "task.receipt",
      task_id: "T99-test-task",
      status: "pass",
      reason_code: null,
      summary: "All verification tests passed cleanly",
      created_at: "2026-10-26T12:00:00Z",
      attempt: 1,
      attempts: 1,
      target_system: { name: "homelab" },
      question: { text: "Verify test suite" },
      model: { id: "test-model" },
      evidence: [
        {
          kind: "command",
          cmd: "bun test",
          cmd_sha256: "0".repeat(64),
          exit: 0,
          duration_ms: 125,
        },
      ],
      tokens: { in: 100, out: 50, total: 150, source: "exact" },
      cost_usd: null,
    };

    const embed = formatReceiptDiscordEmbed(mockReceipt);
    expect(embed.title).toContain("T99-test-task");
    expect(embed.color).toBe(0x34d399); // Green for pass
    expect(embed.fields.some((f: any) => f.name === "Status" && f.value.includes("PASS"))).toBe(true);
    expect(embed.fields.some((f: any) => f.name === "Execution" && f.value.includes("exit 0"))).toBe(true);
  });

  it("3. sendDiscordMessage fails gracefully when token is invalid or missing", async () => {
    const res = await sendDiscordMessage("Test message", undefined, {
      token: "invalid-token",
      channelId: "12345",
    });
    expect(res.ok).toBe(false);
  });
});
