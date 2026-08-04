import { describe, expect, it } from "vitest";
import { TelegramAccountSchema, TelegramConfigSchema } from "./zod-schema.providers-core.js";

describe("Telegram bot-to-bot configuration", () => {
  it("accepts allowBots and botLoopProtection at channel and account scope", () => {
    const botLoopProtection = {
      enabled: true,
      maxEventsPerWindow: 20,
      windowSeconds: 60,
      cooldownSeconds: 60,
    };

    expect(
      TelegramConfigSchema.safeParse({
        allowBots: false,
        botLoopProtection,
        accounts: {
          relay: {
            allowBots: true,
            botLoopProtection: { enabled: false },
          },
        },
      }).success,
    ).toBe(true);
    expect(TelegramAccountSchema.safeParse({ allowBots: true, botLoopProtection }).success).toBe(
      true,
    );
  });

  it("rejects invalid bot-loop protection limits", () => {
    expect(
      TelegramConfigSchema.safeParse({
        botLoopProtection: { maxEventsPerWindow: 0 },
      }).success,
    ).toBe(false);
  });
});
