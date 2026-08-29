#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const configPath = process.argv[2];
const profile = process.argv[3] ?? "stage";
if (!configPath) {
  throw new Error("usage: validate-stage-config.mjs OPENCLAW_CONFIG [stage|production]");
}
if (profile !== "stage" && profile !== "production") {
  throw new Error(`unsupported config validation profile: ${profile}`);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const matrixPath = path.resolve(
  scriptDir,
  "../docs/reference/secretref-user-supplied-credentials-matrix.json",
);
const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const failures = [];

const productionAllowedEnvIdsByPattern = new Map(
  Object.entries({
    "gateway.auth.token": ["OPENCLAW_GATEWAY_TOKEN"],
    "gateway.auth.password": ["OPENCLAW_GATEWAY_PASSWORD"],
    "hooks.token": ["OPENCLAW_HOOKS_TOKEN"],
    "channels.discord.token": ["DISCORD_BOT_TOKEN"],
    "channels.discord.accounts.*.token": ["DISCORD_BOT_TOKEN"],
    "channels.telegram.botToken": ["TELEGRAM_BOT_TOKEN"],
    "channels.telegram.accounts.*.botToken": ["TELEGRAM_BOT_TOKEN"],
    "channels.slack.botToken": ["SLACK_BOT_TOKEN"],
    "channels.slack.accounts.*.botToken": ["SLACK_BOT_TOKEN"],
    "models.providers.google.apiKey": ["GOOGLE_API_KEY"],
    "models.providers.groq.apiKey": ["GROQ_API_KEY"],
    "models.providers.nvidia.apiKey": ["NVIDIA_API_KEY"],
    "models.providers.openai.apiKey": ["OPENAI_API_KEY"],
    "models.providers.openrouter.apiKey": ["OPENROUTER_API_KEY"],
    "plugins.entries.codex.config.appServer.authToken": ["GITHUB_TOKEN"],
  }).map(([pattern, ids]) => [pattern, new Set(ids)]),
);
const stageProjectedCredentialIds = new Set(["OPENCLAW_GATEWAY_TOKEN"]);
const envTemplatePattern = /^\$\{([A-Z][A-Z0-9_]{0,127})\}$/;
const envIdPattern = /^[A-Z][A-Z0-9_]{0,127}$/;
const sensitiveKeyPattern =
  /(?:token|secret|password|api_?key|private_?key|access_?token|auth_?token|app_?token|bot_?token|signing_?secret|client_?secret|app_?password|service_?account)$/iu;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const entries = Array.isArray(matrix.entries) ? matrix.entries : [];
const credentialPatterns = entries.flatMap((entry) => [
  { pattern: entry.path, kind: "credential" },
  ...(entry.refPath ? [{ pattern: entry.refPath, kind: "credential-ref" }] : []),
]);
const unsupportedPatterns = (
  Array.isArray(matrix.excludedMutableOrRuntimeManaged)
    ? matrix.excludedMutableOrRuntimeManaged
    : []
).map((pattern) => ({ pattern, kind: "unsupported" }));
const surfacePatterns = [...credentialPatterns, ...unsupportedPatterns].map((entry) => ({
  ...entry,
  tokens: entry.pattern.split(".").filter(Boolean),
}));

const actualPathMatchesPattern = (actualPath, tokens) => {
  const actual = actualPath.split(".").filter(Boolean);
  let index = 0;
  for (const token of tokens) {
    if (token === "*") {
      if (index >= actual.length) {
        return false;
      }
      index += 1;
      continue;
    }
    if (token.endsWith("[]")) {
      const key = token.slice(0, -2);
      if (actual[index] !== key || !/^\d+$/u.test(actual[index + 1] ?? "")) {
        return false;
      }
      index += 2;
      continue;
    }
    if (actual[index] !== token) {
      return false;
    }
    index += 1;
  }
  return index === actual.length;
};

const actualPathMatchesPatternString = (actualPath, pattern) =>
  actualPathMatchesPattern(actualPath, pattern.split(".").filter(Boolean));

const matchingSurface = (actualPath) =>
  surfacePatterns.find((entry) => actualPathMatchesPattern(actualPath, entry.tokens));

const isSecretRefObject = (value) => {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    value.source === "env" &&
    value.provider === "default" &&
    typeof value.id === "string" &&
    envIdPattern.test(value.id)
  );
};

const looksLikeSecretRefObject = (value) => {
  if (!isRecord(value)) {
    return false;
  }
  const secretRefKeyCount = ["source", "provider", "id"].filter((key) => key in value).length;
  if (secretRefKeyCount < 2) {
    return false;
  }
  return "source" in value || (value.provider === "default" && "id" in value);
};

const parseEnvReference = (value) => {
  if (isSecretRefObject(value)) {
    return { id: value.id, shape: "SecretRef" };
  }
  if (typeof value !== "string") {
    return null;
  }
  const match = envTemplatePattern.exec(value.trim());
  return match ? { id: match[1], shape: "env-template" } : null;
};

const isSensitivePath = (actualPath, value) => {
  const surface = matchingSurface(actualPath);
  if (surface) {
    return true;
  }
  if (looksLikeSecretRefObject(value)) {
    return true;
  }
  const lastSegment = actualPath.split(".").at(-1) ?? "";
  return (
    sensitiveKeyPattern.test(lastSegment) &&
    (typeof value === "string" || looksLikeSecretRefObject(value))
  );
};

const allowedEnvIdsFor = (actualPath, surface) => {
  if (profile === "stage") {
    return actualPath === "gateway.auth.token" && surface?.kind !== "unsupported"
      ? stageProjectedCredentialIds
      : new Set();
  }
  for (const [pattern, ids] of productionAllowedEnvIdsByPattern) {
    if (actualPathMatchesPatternString(actualPath, pattern)) {
      return ids;
    }
  }
  return new Set();
};

const validateSecretInput = (actualPath, value, surface) => {
  const ref = parseEnvReference(value);
  const allowedIds = allowedEnvIdsFor(actualPath, surface);

  if (ref) {
    if (!surface) {
      failures.push(`${actualPath} is not in the supported credential matrix`);
      return;
    }
    if (surface?.kind === "unsupported" && ref.shape !== "env-template") {
      failures.push(
        `${actualPath} must use the approved env template string, not a SecretRef object`,
      );
      return;
    }
    if (!allowedIds.has(ref.id)) {
      failures.push(`${actualPath} references unprojected env id ${ref.id}`);
    }
    return;
  }

  if (looksLikeSecretRefObject(value) || (surface && isRecord(value))) {
    failures.push(
      surface
        ? `${actualPath} must use a supported env SecretRef or exact env template`
        : `${actualPath} is not in the supported credential matrix`,
    );
    return;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    failures.push(
      surface
        ? `${actualPath} contains a literal or composite secret`
        : `${actualPath} is not in the supported credential matrix`,
    );
  }
};

const walk = (value, actualPath) => {
  const surface = matchingSurface(actualPath);
  if (isSensitivePath(actualPath, value)) {
    validateSecretInput(actualPath, value, surface);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, `${actualPath}.${index}`));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    walk(child, actualPath ? `${actualPath}.${key}` : key);
  }
};

const channels = config.channels ?? {};
if (profile === "stage" && isRecord(channels)) {
  for (const [channelName, channelConfig] of Object.entries(channels)) {
    if (!isRecord(channelConfig)) {
      continue;
    }
    if (channelConfig.enabled !== false) {
      failures.push(`channels.${channelName}.enabled must be explicitly false`);
    }
    if (isRecord(channelConfig.accounts)) {
      for (const [accountName, accountConfig] of Object.entries(channelConfig.accounts)) {
        if (!isRecord(accountConfig) || accountConfig.enabled === false) {
          continue;
        }
        failures.push(
          `channels.${channelName}.accounts.${accountName}.enabled must be explicitly false`,
        );
      }
    }
  }
}

walk(config, "");

if (failures.length > 0) {
  process.stderr.write(`${profile} config rejected:\n- ${failures.join("\n- ")}\n`);
  process.exit(78);
}

process.stdout.write(
  `${JSON.stringify({ configSafe: true, profile, channels: Object.keys(channels).sort() })}\n`,
);
