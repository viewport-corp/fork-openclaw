#!/usr/bin/env node
// Renders the production compose with `docker compose config` against a Dokploy-style .env
// and proves: a missing optional name is left out (not ""), and required names fail closed.
// Usage: node deploy/dokploy-production-env.test.mjs [compose-file]

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const composeFile = path.resolve(process.argv[2] ?? "deploy/dokploy.production.yml");
const dir = mkdtempSync(path.join(tmpdir(), "openclaw-env-render-"));
copyFileSync(composeFile, path.join(dir, "compose.yml"));

// Only PATH and HOME reach compose, so no shell variable can stand in for the .env file.
const render = (dotenv) => {
  writeFileSync(path.join(dir, ".env"), dotenv);
  return spawnSync("docker", ["compose", "-f", "compose.yml", "config", "--format", "json"], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
};

try {
  const required = "OPENCLAW_GATEWAY_TOKEN=test-gateway\nTELEGRAM_BOT_TOKEN=test-bot\n";

  const ok = render(`${required}APP_NAME=viewport\nSLACK_CHANNEL_ID=\n`);
  assert.equal(ok.status, 0, ok.stderr);
  const env = JSON.parse(ok.stdout).services["openclaw-gateway"].environment;
  assert.equal(env.OPENCLAW_GATEWAY_TOKEN, "test-gateway");
  assert.equal(env.TELEGRAM_BOT_TOKEN, "test-bot");
  assert.equal(env.APP_NAME, "viewport");
  // An empty value written in the Dokploy env is passed through as written.
  assert.equal(env.SLACK_CHANNEL_ID, "");
  assert.equal(env.TZ, "UTC");
  // Names absent from the Dokploy env stay unresolved (null), which compose removes
  // from the container env instead of injecting "".
  for (const name of [
    "GROQ_API_KEY",
    "LITELLM_API_KEY",
    "SLACK_BOT_TOKEN",
    "TELEGRAM_HOME_CHANNEL",
  ]) {
    assert.equal(env[name] ?? null, null, `${name} must be omitted when missing, got ${env[name]}`);
  }
  const blanks = Object.keys(env).filter((name) => env[name] === "" && name !== "SLACK_CHANNEL_ID");
  assert.deepEqual(blanks, [], `names rendered as "" without being set: ${blanks.join(", ")}`);

  for (const name of ["OPENCLAW_GATEWAY_TOKEN", "TELEGRAM_BOT_TOKEN"]) {
    const others = required.replace(new RegExp(`^${name}=.*\\n`, "mu"), "");
    for (const dotenv of [others, `${others}${name}=\n`]) {
      const failed = render(dotenv);
      assert.notEqual(failed.status, 0, `${name} unset or empty must fail the render`);
      assert.match(failed.stderr, new RegExp(`required variable ${name} is missing a value`, "u"));
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.stdout.write("dokploy-production-env tests passed\n");
