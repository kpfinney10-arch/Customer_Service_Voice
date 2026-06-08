import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

test("Telnyx smoke script covers initiated and speech gather events", () => {
  const script = readFileSync(join(process.cwd(), "scripts/telnyx-webhook-smoke.mjs"), "utf8");

  assert.match(script, /call\.initiated/);
  assert.match(script, /call\.ai_gather\.ended/);
  assert.match(script, /telephony\/telnyx\/readiness/);
  assert.match(script, /first-call\/sessions\/\$\{callControlId\}\/replay/);
  assert.match(script, /providerCommandBatches/);
  assert.match(script, /TELNYX_SMOKE_TRANSCRIPT/);
  assert.match(script, /TELNYX_SMOKE_SPEECH_EVENT_ID/);
});
