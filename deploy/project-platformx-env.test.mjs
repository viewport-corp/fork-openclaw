#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const work = mkdtempSync(path.join(tmpdir(), "openclaw-secret-projector-"));
const script = path.resolve("deploy/project-platformx-env.mjs");

const runProjector = (source, destination, profile) =>
  spawnSync(process.execPath, [script, source, destination, profile], {
    encoding: "utf8",
  });

const source = path.join(work, "source.env");
const production = path.join(work, "production.env");
const stage = path.join(work, "stage.env");

try {
  writeFileSync(
    source,
    [
      "OPENCLAW_GATEWAY_TOKEN=gateway-value",
      "OPENCLAW_STAGE_GATEWAY_TOKEN=stage-gateway-value",
      "TELEGRAM_BOT_TOKEN=telegram-value",
      "DISCORD_BOT_TOKEN=discord-value",
      "GITHUB_TOKEN_VIEWPORT_CORP=github-value",
      "SLACK_BOT_TOKEN=slack'quoted",
      "UNRELATED_COMPANY_SECRET=must-not-project",
      "",
    ].join("\n"),
  );

  const productionResult = runProjector(source, production, "production");
  assert.equal(productionResult.status, 0, productionResult.stderr);
  assert.equal(statSync(production).mode & 0o777, 0o400);
  assert.match(productionResult.stdout, /"profile":"production"/);
  assert.doesNotMatch(readFileSync(production, "utf8"), /UNRELATED_COMPANY_SECRET/);

  const productionShell = spawnSync(
    "/bin/sh",
    [
      "-c",
      '. "$1"; test "$OPENCLAW_GATEWAY_TOKEN" = gateway-value && test "$TELEGRAM_BOT_TOKEN" = telegram-value && test "$GITHUB_TOKEN" = github-value && test "$SLACK_BOT_TOKEN" = "slack' +
        "'" +
        'quoted" && test "$DISCORD_BOT_TOKEN" = discord-value && test -z "${UNRELATED_COMPANY_SECRET-}"',
      "sh",
      production,
    ],
    { encoding: "utf8", env: {} },
  );
  assert.equal(productionShell.status, 0, productionShell.stderr);

  const stageResult = runProjector(source, stage, "stage");
  assert.equal(stageResult.status, 0, stageResult.stderr);
  const stageShell = spawnSync(
    "/bin/sh",
    [
      "-c",
      '. "$1"; test "$OPENCLAW_GATEWAY_TOKEN" = stage-gateway-value && test -z "${GITHUB_TOKEN-}" && test -z "${GITHUB_TOKEN_VIEWPORT_CORP-}" && test -z "${GOOGLE_API_KEY-}" && test -z "${GROQ_API_KEY-}" && test -z "${NVIDIA_API_KEY-}" && test -z "${OPENROUTER_API_KEY-}" && test -z "${TELEGRAM_BOT_TOKEN-}" && test -z "${SLACK_BOT_TOKEN-}" && test -z "${DISCORD_BOT_TOKEN-}"',
      "sh",
      stage,
    ],
    { encoding: "utf8", env: {} },
  );
  assert.equal(stageShell.status, 0, stageShell.stderr);

  const missingSource = path.join(work, "missing.env");
  writeFileSync(missingSource, "UNRELATED_COMPANY_SECRET=value\n");
  const missingResult = runProjector(
    missingSource,
    path.join(work, "missing-output.env"),
    "production",
  );
  assert.notEqual(missingResult.status, 0);

  process.stdout.write("project-platformx-env tests passed\n");
} finally {
  rmSync(work, { recursive: true, force: true });
}
