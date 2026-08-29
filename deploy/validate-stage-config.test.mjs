#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const work = mkdtempSync(path.join(tmpdir(), "openclaw-stage-config-"));
const validator = path.resolve("deploy/validate-stage-config.mjs");
const run = (config, profile = "stage") => {
  const configPath = path.join(work, `${Math.random()}.json`);
  writeFileSync(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  return spawnSync(process.execPath, [validator, configPath, profile], { encoding: "utf8" });
};

try {
  const safe = run({
    channels: {
      telegram: { enabled: false },
      discord: {
        enabled: false,
        token: { source: "env", provider: "default", id: "DISCORD_BOT_TOKEN" },
        accounts: { default: { enabled: false } },
      },
    },
    gateway: { auth: { mode: "token" } },
  });
  assert.equal(safe.status, 0, safe.stderr);

  const safeProduction = run(
    {
      channels: {
        telegram: {
          enabled: true,
          botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
        },
      },
      gateway: { auth: { mode: "token" } },
    },
    "production",
  );
  assert.equal(safeProduction.status, 0, safeProduction.stderr);

  const unsafe = run({
    channels: {
      telegram: { enabled: true },
      discord: { enabled: false, accounts: { default: { token: "literal" } } },
    },
    gateway: { auth: { token: "literal" } },
  });
  assert.equal(unsafe.status, 78);
  assert.match(unsafe.stderr, /channels\.telegram\.enabled must be explicitly false/);
  assert.match(
    unsafe.stderr,
    /channels\.discord\.accounts\.default\.token contains a literal secret/,
  );
  assert.match(unsafe.stderr, /gateway\.auth\.token contains a literal secret/);

  process.stdout.write("validate-stage-config tests passed\n");
} finally {
  rmSync(work, { recursive: true, force: true });
}
