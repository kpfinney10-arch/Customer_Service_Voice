import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package exposes local human-testing smoke script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(pkg.scripts?.["smoke:extraction"], "node scripts/first-call-extraction-smoke.mjs");
  assert.equal(pkg.scripts?.["smoke:human-test"], "node scripts/human-testing-smoke.mjs");
  assert.equal(pkg.scripts?.["smoke:telnyx"], "node scripts/telnyx-webhook-smoke.mjs");
  assert.equal(pkg.scripts?.["smoke:twilio"], "node scripts/twilio-webhook-smoke.mjs");
  assert.equal(pkg.scripts?.["smoke:twilio-readiness"], "node scripts/twilio-readiness-smoke.mjs");
});
