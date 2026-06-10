import { describe, expect, it } from "vitest";
import {
  resolveTelegramBotLoopProtection,
  shouldDropTelegramBotMessage,
} from "./bot-loop-protection.js";

const botFrom = { id: 555, is_bot: true as const, first_name: "PeerBot" };
const humanFrom = { id: 111, is_bot: false as const, first_name: "Alice" };

describe("resolveTelegramBotLoopProtection", () => {
  it("returns pair facts for messages authored by another bot", () => {
    const facts = resolveTelegramBotLoopProtection({
      msg: { from: botFrom, date: 1_770_000_000 },
      accountId: "default",
      chatId: -100123,
      selfBotId: 999,
      telegramCfg: { botLoopProtection: { maxEventsPerWindow: 5 } },
      defaultsConfig: { windowSeconds: 30 },
    });
    expect(facts).toEqual({
      scopeId: "default",
      conversationId: "-100123",
      senderId: "555",
      receiverId: "999",
      config: { maxEventsPerWindow: 5 },
      defaultsConfig: { windowSeconds: 30 },
      defaultEnabled: true,
      nowMs: 1_770_000_000_000,
    });
  });

  it("returns undefined for human-authored messages", () => {
    expect(
      resolveTelegramBotLoopProtection({
        msg: { from: humanFrom, date: 1_770_000_000 },
        accountId: "default",
        chatId: -100123,
        selfBotId: 999,
      }),
    ).toBeUndefined();
  });

  it("returns undefined for messages without a sender", () => {
    expect(
      resolveTelegramBotLoopProtection({
        msg: { date: 1_770_000_000 },
        accountId: "default",
        chatId: -100123,
        selfBotId: 999,
      }),
    ).toBeUndefined();
  });

  it("returns undefined for our own messages and unknown self id", () => {
    expect(
      resolveTelegramBotLoopProtection({
        msg: { from: { ...botFrom, id: 999 }, date: 1_770_000_000 },
        accountId: "default",
        chatId: -100123,
        selfBotId: 999,
      }),
    ).toBeUndefined();
    expect(
      resolveTelegramBotLoopProtection({
        msg: { from: botFrom, date: 1_770_000_000 },
        accountId: "default",
        chatId: -100123,
      }),
    ).toBeUndefined();
  });

  it("omits guard config when the account sets none", () => {
    const facts = resolveTelegramBotLoopProtection({
      msg: { from: botFrom, date: 1_770_000_000 },
      accountId: "default",
      chatId: -100123,
      selfBotId: 999,
      telegramCfg: {},
    });
    expect(facts?.config).toBeUndefined();
    expect(facts?.defaultEnabled).toBe(true);
  });
});

describe("shouldDropTelegramBotMessage", () => {
  it("keeps bot messages by default and when allowBots is true", () => {
    expect(shouldDropTelegramBotMessage({ msg: { from: botFrom } })).toBe(false);
    expect(shouldDropTelegramBotMessage({ msg: { from: botFrom }, telegramCfg: {} })).toBe(false);
    expect(
      shouldDropTelegramBotMessage({ msg: { from: botFrom }, telegramCfg: { allowBots: true } }),
    ).toBe(false);
  });

  it("drops bot messages when allowBots is false", () => {
    expect(
      shouldDropTelegramBotMessage({ msg: { from: botFrom }, telegramCfg: { allowBots: false } }),
    ).toBe(true);
  });

  it("never drops human messages", () => {
    expect(
      shouldDropTelegramBotMessage({ msg: { from: humanFrom }, telegramCfg: { allowBots: false } }),
    ).toBe(false);
    expect(shouldDropTelegramBotMessage({ msg: {}, telegramCfg: { allowBots: false } })).toBe(
      false,
    );
  });
});
