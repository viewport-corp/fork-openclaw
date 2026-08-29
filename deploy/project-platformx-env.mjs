#!/usr/bin/env node

import {
  chmodSync,
  chownSync,
  closeSync,
  constants,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import process from "node:process";
import dotenv from "dotenv";

const sourcePath = process.argv[2];
const destinationPath = process.argv[3];
const profile = process.argv[4] ?? "production";

if (!sourcePath || !destinationPath) {
  throw new Error("usage: project-platformx-env.mjs SOURCE DESTINATION [production|stage]");
}
if (profile !== "production" && profile !== "stage") {
  throw new Error(`unsupported secret profile: ${profile}`);
}

const gatewayKeys = [
  "OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_PASSWORD",
  "OPENCLAW_HOOKS_TOKEN",
  "GITHUB_TOKEN",
  "GITHUB_TOKEN_VIEWPORT_CORP",
  "GOOGLE_API_KEY",
  "GROQ_API_KEY",
  "NVIDIA_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENCLAW_TZ",
];
const stageKeys = ["OPENCLAW_STAGE_GATEWAY_TOKEN", "OPENCLAW_TZ"];
const productionChannelKeys = [
  "DISCORD_BOT_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_ALLOWED_USERS",
  "TELEGRAM_HOME_CHANNEL",
  "TELEGRAM_HOME_CHANNEL_NAME",
  "SLACK_BOT_TOKEN",
  "SLACK_CHANNEL_ID",
];
const allowedKeys =
  profile === "production" ? [...gatewayKeys, ...productionChannelKeys] : stageKeys;

const parsed = dotenv.parse(readFileSync(sourcePath, "utf8"));
const selected = Object.fromEntries(
  allowedKeys
    .filter((key) => typeof parsed[key] === "string" && parsed[key].length > 0)
    .map((key) => [key, parsed[key]]),
);

if (profile === "stage" && selected.OPENCLAW_STAGE_GATEWAY_TOKEN) {
  selected.OPENCLAW_GATEWAY_TOKEN = selected.OPENCLAW_STAGE_GATEWAY_TOKEN;
  delete selected.OPENCLAW_STAGE_GATEWAY_TOKEN;
}
if (!selected.OPENCLAW_GATEWAY_TOKEN && !selected.OPENCLAW_GATEWAY_PASSWORD) {
  throw new Error(
    "canonical secret source lacks OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD",
  );
}
if (profile === "production" && !selected.TELEGRAM_BOT_TOKEN) {
  throw new Error("canonical secret source lacks TELEGRAM_BOT_TOKEN for the production profile");
}
if (!selected.GITHUB_TOKEN && selected.GITHUB_TOKEN_VIEWPORT_CORP) {
  selected.GITHUB_TOKEN = selected.GITHUB_TOKEN_VIEWPORT_CORP;
}

const quoteForShell = (value) => {
  if (value.includes("\0")) {
    throw new Error("secret values must not contain NUL bytes");
  }
  return `'${value.replaceAll("'", `'\\''`)}'`;
};
const content = `${Object.keys(selected)
  .sort()
  .map((key) => `export ${key}=${quoteForShell(selected[key])}`)
  .join("\n")}\n`;

const temporaryPath = `${destinationPath}.${process.pid}.tmp`;
const descriptor = openSync(
  temporaryPath,
  constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
  0o400,
);
try {
  writeFileSync(descriptor, content, { encoding: "utf8" });
} finally {
  closeSync(descriptor);
}
chmodSync(temporaryPath, 0o400);
if (process.getuid?.() === 0) {
  chownSync(temporaryPath, 1000, 1000);
}
renameSync(temporaryPath, destinationPath);

process.stdout.write(
  `${JSON.stringify({ profile, projectedKeys: Object.keys(selected).sort(), destinationPath })}\n`,
);
