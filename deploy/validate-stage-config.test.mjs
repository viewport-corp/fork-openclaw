#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const work = mkdtempSync(path.join(tmpdir(), "openclaw-stage-config-"));
const validator = path.resolve("deploy/validate-stage-config.mjs");
const envRef = (id) => ({ source: "env", provider: "default", id });
const run = (config, profile = "stage") => {
  const configPath = path.join(work, `${Math.random()}.json`);
  writeFileSync(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  return spawnSync(process.execPath, [validator, configPath, profile], { encoding: "utf8" });
};
const assertAccepted = (config, profile = "stage") => {
  const result = run(config, profile);
  assert.equal(result.status, 0, result.stderr);
  return result;
};
const assertRejected = (config, pattern, profile = "stage") => {
  const result = run(config, profile);
  assert.equal(result.status, 78, result.stderr || result.stdout);
  assert.match(result.stderr, pattern);
  return result;
};

try {
  assertAccepted({
    channels: {
      telegram: { enabled: false },
      discord: { enabled: false, accounts: { default: { enabled: false } } },
    },
    gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
  });

  assertAccepted(
    {
      channels: {
        telegram: { enabled: false },
        discord: { enabled: false },
      },
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      agents: {
        list: [
          {
            id: "ops-agent",
            model: { provider: "openai", id: "gpt-5.6-sol" },
            agentRuntime: { id: "runtime-default", kind: "local" },
          },
        ],
      },
      models: {
        list: [{ provider: "openai", id: "gpt-5.6-sol" }],
        selected: { provider: "openai", id: "gpt-5.6-sol" },
      },
    },
    "production",
  );

  assertAccepted(
    {
      channels: {
        telegram: {
          enabled: true,
          botToken: envRef("TELEGRAM_BOT_TOKEN"),
          accounts: {
            ops: {
              enabled: true,
              botToken: "${TELEGRAM_BOT_TOKEN}",
            },
          },
        },
        discord: {
          enabled: true,
          token: "${DISCORD_BOT_TOKEN}",
          accounts: { ops: { enabled: true, token: envRef("DISCORD_BOT_TOKEN") } },
        },
        slack: {
          enabled: true,
          botToken: envRef("SLACK_BOT_TOKEN"),
          accounts: { ops: { enabled: true, botToken: "${SLACK_BOT_TOKEN}" } },
        },
      },
      gateway: {
        auth: {
          mode: "token",
          token: "${OPENCLAW_GATEWAY_TOKEN}",
          password: envRef("OPENCLAW_GATEWAY_PASSWORD"),
        },
      },
      hooks: { token: "${OPENCLAW_HOOKS_TOKEN}" },
      models: {
        providers: {
          google: { apiKey: envRef("GOOGLE_API_KEY") },
          groq: { apiKey: envRef("GROQ_API_KEY") },
          nvidia: { apiKey: envRef("NVIDIA_API_KEY") },
          openai: { apiKey: envRef("OPENAI_API_KEY") },
          openrouter: {
            apiKey: envRef("OPENROUTER_API_KEY"),
          },
        },
      },
      plugins: {
        entries: {
          codex: { config: { appServer: { authToken: envRef("GITHUB_TOKEN") } } },
        },
      },
    },
    "production",
  );

  assertRejected(
    {
      channels: {
        telegram: { enabled: true },
        discord: { enabled: false, accounts: { default: { enabled: true } } },
      },
      gateway: { auth: { token: "literal" } },
    },
    /channels\.telegram\.enabled must be explicitly false/,
  );

  assertRejected(
    {
      channels: {
        discord: {
          enabled: false,
          accounts: { default: { enabled: false, credentials: [{ token: "literal" }] } },
        },
      },
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
    },
    /channels\.discord\.accounts\.default\.credentials\.0\.token is not in the supported credential matrix/,
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: "${OPENCLAW_GATEWAY_TOKEN:-fallback}" } },
    },
    /gateway\.auth\.token contains a literal or composite secret/,
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: "\\${OPENCLAW_GATEWAY_TOKEN}" } },
    },
    /gateway\.auth\.token contains a literal or composite secret/,
  );

  assertRejected(
    {
      gateway: {
        auth: { mode: "token", token: { source: "file", provider: "default", id: "/x" } },
      },
    },
    /gateway\.auth\.token must use a supported env SecretRef or exact env template/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: { id: "OPENCLAW_GATEWAY_TOKEN" } } },
    },
    /gateway\.auth\.token must use a supported env SecretRef or exact env template/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      experimental: { ref: { source: "env", id: "GITHUB_TOKEN" } },
    },
    /experimental\.ref is not in the supported credential matrix/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      experimental: { ref: { provider: "default", id: "GITHUB_TOKEN" } },
    },
    /experimental\.ref is not in the supported credential matrix/,
    "production",
  );

  assertRejected(
    {
      gateway: {
        auth: { mode: "token", token: { source: "env", provider: "default", id: "bad" } },
      },
    },
    /gateway\.auth\.token must use a supported env SecretRef or exact env template/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("UNPROJECTED_GATEWAY_TOKEN") } },
    },
    /gateway\.auth\.token references unprojected env id UNPROJECTED_GATEWAY_TOKEN/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      experimental: { ref: envRef("GITHUB_TOKEN") },
    },
    /experimental\.ref is not in the supported credential matrix/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      experimental: { apiKey: "${GITHUB_TOKEN}" },
    },
    /experimental\.apiKey is not in the supported credential matrix/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      hooks: { token: envRef("OPENCLAW_HOOKS_TOKEN") },
    },
    /hooks\.token must use the approved env template string, not a SecretRef object/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      channels: {
        telegram: {
          enabled: true,
          botToken: envRef("TELEGRAM_BOT_TOKEN"),
          accounts: {
            ops: {
              enabled: true,
              botToken: envRef("TELEGRAM_BOT_TOKEN"),
              webhookSecret: envRef("OPENCLAW_GATEWAY_TOKEN"),
            },
          },
        },
      },
    },
    /channels\.telegram\.accounts\.ops\.webhookSecret references unprojected env id OPENCLAW_GATEWAY_TOKEN/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      channels: {
        discord: {
          enabled: true,
          threadBindings: { webhookToken: envRef("DISCORD_BOT_TOKEN") },
        },
      },
    },
    /channels\.discord\.threadBindings\.webhookToken must use the approved env template string, not a SecretRef object/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      models: {
        providers: {
          openrouter: {
            apiKey: envRef("OPENROUTER_API_KEY"),
            request: { proxy: { tls: { ca: envRef("OPENCLAW_GATEWAY_TOKEN") } } },
          },
        },
      },
    },
    /models\.providers\.openrouter\.request\.proxy\.tls\.ca references unprojected env id OPENCLAW_GATEWAY_TOKEN/,
    "production",
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      models: {
        providers: {
          openrouter: {
            apiKey: envRef("OPENROUTER_API_KEY"),
            request: { headers: { Authorization: "${OPENROUTER_API_KEY}" } },
          },
        },
      },
    },
    /models\.providers\.openrouter\.request\.headers\.Authorization references unprojected env id OPENROUTER_API_KEY/,
    "production",
  );

  assertRejected(
    {
      gateway: {
        auth: {
          mode: "token",
          token: envRef("OPENCLAW_GATEWAY_TOKEN"),
          password: envRef("OPENCLAW_GATEWAY_PASSWORD"),
        },
      },
    },
    /gateway\.auth\.password references unprojected env id OPENCLAW_GATEWAY_PASSWORD/,
  );

  assertRejected(
    {
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
      models: { providers: { openrouter: { apiKey: envRef("OPENROUTER_API_KEY") } } },
    },
    /models\.providers\.openrouter\.apiKey references unprojected env id OPENROUTER_API_KEY/,
  );

  assertRejected(
    {
      channels: { telegram: { enabled: false, botToken: envRef("TELEGRAM_BOT_TOKEN") } },
      gateway: { auth: { mode: "token", token: envRef("OPENCLAW_GATEWAY_TOKEN") } },
    },
    /channels\.telegram\.botToken references unprojected env id TELEGRAM_BOT_TOKEN/,
  );

  process.stdout.write("validate-stage-config tests passed\n");
} finally {
  rmSync(work, { recursive: true, force: true });
}
