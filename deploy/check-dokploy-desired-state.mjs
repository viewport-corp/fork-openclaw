#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "deploy/dokploy.desired-state.json");
const composePath = path.join(rootDir, "deploy/dokploy.production.yml");
const stageComposePath = path.join(rootDir, "deploy/dokploy.stage.yml");

const desired = JSON.parse(readFileSync(manifestPath, "utf8"));
const compose = readFileSync(composePath, "utf8");
const stageCompose = readFileSync(stageComposePath, "utf8");

assert.equal(desired.composeId, "pEotki2dpeakRxHTx3_Tt");
assert.equal(desired.sourceType, "git");
assert.equal(desired.customGitUrl, "https://github.com/viewport-corp/fork-openclaw.git");
assert.equal(desired.customGitBranch, "main");
assert.equal(desired.composePath, "deploy/dokploy.production.yml");
assert.equal(desired.composeType, "docker-compose");
const officialImagePattern = /^ghcr\.io\/openclaw\/openclaw:\d{4}\.\d+\.\d+@sha256:[a-f0-9]{64}$/u;
assert.match(desired.image, officialImagePattern);
assert.match(desired.imageRevision, /^[a-f0-9]{40}$/u);
assert.equal(desired.upgradePath[0].image, desired.image);
assert.equal(desired.upgradePath[0].revision, desired.imageRevision);
for (const step of desired.upgradePath) {
  assert.match(step.image, officialImagePattern);
  assert.match(step.revision, /^[a-f0-9]{40}$/u);
}
assert.equal(
  desired.rollback.image,
  "viewport-corp/openclaw@sha256:46502ae3633270c5e27b1f8c7095761e223490aaa6cdf4fdc0a4337201f27fa0",
);

assert.equal(desired.network.external, true);
assert.equal(desired.network.name, "fork-openclaw_default");
assert.equal(desired.network.nameEnv, "OPENCLAW_NETWORK_NAME");
assert.equal(desired.network.gatewayService, "openclaw-gateway");
assert.equal(desired.network.gatewayAlias, "openclaw-gateway");
assert.equal(desired.network.hostGatewayPort, "127.0.0.1:47295");

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
assert.match(
  compose,
  new RegExp(`\nx-openclaw-image: &openclaw-image ${escapeRegExp(desired.image)}\n`, "u"),
);
assert.equal((compose.match(/\n    pull_policy: if_not_present\n/gu) ?? []).length, 1);
assert.match(compose, /name: \$\{OPENCLAW_NETWORK_NAME:-fork-openclaw_default\}/u);
assert.match(compose, /\n        aliases: \[openclaw-gateway\]\n/u);
assert.match(compose, /\n      - "127\.0\.0\.1:47295:18789"\n/u);
assert.equal(compose.includes("ipv4_address"), false);
assert.match(compose, /\n    group_add: \["988"\]\n/u);
assert.match(compose, /\n      - \/var\/run\/docker-viewport\.sock:\/var\/run\/docker\.sock\n/u);
for (const state of ["config", "workspace", "auth-secrets", "codex-auth", "ssh"]) {
  assert.match(
    compose,
    new RegExp(`\n      - /srv/viewport/runtime/openclaw-viewport/${state}:`, "u"),
  );
}

// The official image has no fork helpers and runs its own entrypoint.
for (const text of [compose, stageCompose]) {
  assert.equal(text.includes("/app/deploy/"), false);
  assert.equal(text.includes("platformx.env"), false);
  assert.equal(text.includes("fork-openclaw@sha256"), false);
}
assert.equal(/\n    entrypoint:/u.test(compose), false);

// Stage must never receive live channel credentials.
assert.equal(stageCompose.includes("env_file"), false);
for (const name of [
  "TELEGRAM_BOT_TOKEN",
  "DISCORD_BOT_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN",
  "MODERNLAO_TELEGRAM_BOT_TOKEN",
  "IMPORTED_SLACK_BOT_TOKEN",
]) {
  assert.match(stageCompose, new RegExp(`\n  ${name}: ""\n`, "u"));
}
assert.match(stageCompose, /OPENCLAW_GATEWAY_TOKEN: \$\{OPENCLAW_STAGE_GATEWAY_TOKEN:\?/u);
assert.equal(
  stageCompose.split("validate-stage-config.mjs /home/node/.openclaw/openclaw.json stage").length -
    1,
  1,
);

const configCheckTmpfs = "    tmpfs:\n" + "      - /tmp:size=64m,mode=1777,noexec,nosuid,nodev\n";
assert.equal(stageCompose.split(configCheckTmpfs).length - 1, 1);

process.stdout.write(
  JSON.stringify({ dokployDesiredStateSafe: true, composeId: desired.composeId }) + "\n",
);
