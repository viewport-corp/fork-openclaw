import type { Message } from "grammy/types";
import type { ChannelBotLoopProtectionFacts } from "openclaw/plugin-sdk/channel-inbound";
import type { TelegramAccountConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  mergePairLoopGuardConfig,
  type PairLoopGuardConfig,
} from "openclaw/plugin-sdk/pair-loop-guard-runtime";

/**
 * Telegram Bot API 10.0 bot-to-bot mode delivers group messages authored by
 * peer bots (`from.is_bot === true`). Telegram requires bots to implement
 * their own loop protection once the mode is enabled:
 * https://core.telegram.org/bots/features#bot-to-bot-communication
 *
 * This mirrors the Discord/Slack/Matrix wiring of the shared pair
 * sliding-window guard (#80719): facts are attached to the channel turn and
 * the kernel suppresses runaway two-bot exchanges
 * (`channels.telegram.botLoopProtection`, falling back to
 * `channels.defaults.botLoopProtection`; defaults: 20 events / 60s window /
 * 60s cooldown).
 */
export function resolveTelegramBotLoopProtection(params: {
  msg: Pick<Message, "from" | "date">;
  accountId: string;
  chatId: number | string;
  selfBotId?: number;
  telegramCfg?: Pick<TelegramAccountConfig, "botLoopProtection">;
  defaultsConfig?: PairLoopGuardConfig;
}): ChannelBotLoopProtectionFacts | undefined {
  const from = params.msg.from;
  if (from?.is_bot !== true) {
    return undefined;
  }
  if (params.selfBotId == null || from.id === params.selfBotId) {
    return undefined;
  }
  return {
    scopeId: params.accountId,
    conversationId: String(params.chatId),
    senderId: String(from.id),
    receiverId: String(params.selfBotId),
    config: mergePairLoopGuardConfig(params.telegramCfg?.botLoopProtection),
    defaultsConfig: params.defaultsConfig,
    defaultEnabled: true,
    nowMs: typeof params.msg.date === "number" ? params.msg.date * 1000 : undefined,
  };
}

/**
 * Resolve the `channels.telegram.allowBots` gate for an inbound message.
 * Returns true when the message should be dropped before dispatch.
 *
 * Default keeps bot-authored messages flowing (`allowBots !== false`):
 * Telegram's BotFather toggle is the platform-level opt-in, the regular
 * allowFrom/group gating still applies, and pre-10.0 fork behavior never
 * filtered bot senders.
 */
export function shouldDropTelegramBotMessage(params: {
  msg: Pick<Message, "from">;
  telegramCfg?: Pick<TelegramAccountConfig, "allowBots">;
}): boolean {
  return params.msg.from?.is_bot === true && params.telegramCfg?.allowBots === false;
}
