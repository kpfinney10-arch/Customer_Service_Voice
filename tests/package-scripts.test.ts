import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package exposes local human-testing smoke script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(pkg.scripts?.["start:twilio-local"], "node scripts/start-twilio-local.mjs");
  assert.equal(pkg.scripts?.["start:twilio-tunnel"], "node scripts/start-twilio-tunnel.mjs");
  assert.equal(pkg.scripts?.build, "tsc -p tsconfig.json && node scripts/write-build-metadata.mjs");
  assert.equal(pkg.scripts?.["data:purge"], "node dist/src/persistence/data-lifecycle-main.js tenant-purge");
  assert.equal(pkg.scripts?.["data:retention"], "node dist/src/persistence/data-lifecycle-main.js retention");
  assert.equal(pkg.scripts?.["smoke:extraction"], "node scripts/first-call-extraction-smoke.mjs");
  assert.equal(pkg.scripts?.["smoke:human-test"], "node scripts/human-testing-smoke.mjs");
  assert.equal(pkg.scripts?.["smoke:telnyx"], "node scripts/telnyx-webhook-smoke.mjs");
  assert.equal(pkg.scripts?.["smoke:twilio"], "node scripts/twilio-webhook-smoke.mjs");
  assert.equal(pkg.scripts?.["smoke:twilio-scenarios"], "node scripts/twilio-scenario-matrix-smoke.mjs");
  assert.equal(pkg.scripts?.["smoke:twilio-readiness"], "node scripts/twilio-readiness-smoke.mjs");
});

test("Twilio scenario matrix exercises ConversationRelay with bounded concurrency and reserved fixtures", async () => {
  const source = await readFile("scripts/twilio-scenario-matrix-smoke.mjs", "utf8");

  assert.match(source, /new WebSocket\(relayConnectUrl/);
  assert.match(source, /createBarrier\(batch\.length\)/);
  assert.match(source, /TWILIO_SCENARIO_CONCURRENCY/);
  assert.match(source, /\+12025550100/);
  assert.match(source, /202-555-0106/);
});
