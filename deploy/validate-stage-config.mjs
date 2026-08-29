#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";

const configPath = process.argv[2];
const profile = process.argv[3] ?? "stage";
if (!configPath) {
  throw new Error("usage: validate-stage-config.mjs OPENCLAW_CONFIG [stage|production]");
}
if (profile !== "stage" && profile !== "production") {
  throw new Error(`unsupported config validation profile: ${profile}`);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
const failures = [];
const channels = config.channels ?? {};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isSensitiveKey = (key) => /(token|secret|password|api_?key|private_?key)$/iu.test(key);

const findLiteralSecrets = (value, path) => {
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (isSensitiveKey(key) && typeof child === "string" && child.length > 0) {
      failures.push(`${childPath} contains a literal secret`);
      continue;
    }
    findLiteralSecrets(child, childPath);
  }
};

for (const [channelName, channelConfig] of Object.entries(channels)) {
  if (!isRecord(channelConfig)) {
    continue;
  }
  if (profile === "stage" && channelConfig.enabled !== false) {
    failures.push(`channels.${channelName}.enabled must be explicitly false`);
  }
  if (isRecord(channelConfig.accounts)) {
    for (const [accountName, accountConfig] of Object.entries(channelConfig.accounts)) {
      if (profile === "stage" && isRecord(accountConfig) && accountConfig.enabled !== false) {
        failures.push(
          `channels.${channelName}.accounts.${accountName}.enabled must be explicitly false`,
        );
      }
    }
  }
  findLiteralSecrets(channelConfig, `channels.${channelName}`);
}
findLiteralSecrets(config.gateway?.auth, "gateway.auth");

if (failures.length > 0) {
  process.stderr.write(`stage config rejected:\n- ${failures.join("\n- ")}\n`);
  process.exit(78);
}

process.stdout.write(
  `${JSON.stringify({ configSafe: true, profile, channels: Object.keys(channels).sort() })}\n`,
);
