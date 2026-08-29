#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const manifestPath = path.join(rootDir, "deploy/dokploy.desired-state.json");
const composePath = path.join(rootDir, "deploy/dokploy.production.yml");

const desired = JSON.parse(readFileSync(manifestPath, "utf8"));
const compose = readFileSync(composePath, "utf8");

assert.equal(desired.composeId, "pEotki2dpeakRxHTx3_Tt");
assert.equal(desired.sourceType, "git");
assert.equal(desired.customGitUrl, "https://github.com/viewport-corp/fork-openclaw.git");
assert.equal(desired.customGitBranch, "main");
assert.equal(desired.composePath, "deploy/dokploy.production.yml");
assert.equal(desired.composeType, "docker-compose");
assert.match(desired.image, /^ghcr\.io\/viewport-corp\/fork-openclaw@sha256:[a-f0-9]{64}$/u);

assert.equal(desired.network.external, true);
assert.equal(desired.network.name, "fork-openclaw_default");
assert.equal(desired.network.nameEnv, "OPENCLAW_NETWORK_NAME");
assert.equal(desired.network.gatewayService, "openclaw-gateway");
assert.equal(desired.network.gatewayIpv4Address, "172.31.16.2");
assert.equal(desired.network.gatewayIpv4AddressEnv, "OPENCLAW_IPV4_ADDRESS");

assert.match(compose, new RegExp("x-openclaw-image: &openclaw-image " + desired.image));
assert.match(compose, /\n    pull_policy: if_not_present\n/u);
assert.match(compose, /name: \$\{OPENCLAW_NETWORK_NAME:-fork-openclaw_default\}/u);
assert.match(compose, /ipv4_address: \$\{OPENCLAW_IPV4_ADDRESS:-172\.31\.16\.2\}/u);

const pullPolicyCount = (compose.match(/\n    pull_policy: if_not_present\n/gu) ?? []).length;
assert.equal(pullPolicyCount, 3);

process.stdout.write(
  JSON.stringify({ dokployDesiredStateSafe: true, composeId: desired.composeId }) + "\n",
);
