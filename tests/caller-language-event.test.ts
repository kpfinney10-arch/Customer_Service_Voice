import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirstCallService } from "../src/api/first-call-service.js";
import { InMemoryEventStore } from "../src/events/in-memory-event-store.js";
import {
  createCallerLanguageCache,
  generateCallerLanguage,
  prepareCallerLanguageRuntime,
} from "../src/orchestrator/caller-language.js";
import type { CallerLanguageRuntime } from "../src/orchestrator/caller-language.js";
import {
  REVIEWED_CALLER_LANGUAGE_BUNDLE,
  REVIEWED_CALLER_LANGUAGE_BUNDLE_VERSION,
} from "../src/orchestrator/reviewed-caller-language-bundle.js";
import { InMemorySessionStore } from "../src/session/in-memory-session-store.js";
import { createDefaultTenantConfigStore } from "../src/tenants/tenant-config.js";

test("reviewed caller-language events retain bundle metadata but no wording", async () => {
  const eventStore = new InMemoryEventStore();
  const service = createFirstCallService({
    store: new InMemorySessionStore(),
    eventStore,
    tenantConfigStore: createDefaultTenantConfigStore(),
  });
  const runtime: CallerLanguageRuntime = {
    mode: "reviewed",
    bundle: REVIEWED_CALLER_LANGUAGE_BUNDLE,
    cache: createCallerLanguageCache(),
  };
  await prepareCallerLanguageRuntime(runtime);
  const sessionId = "CAreviewedlanguageevent0000000001";
  await service.startSession({ tenantId: "fh-demo", sessionId, callId: sessionId });
  const outcome = await generateCallerLanguage(runtime, {
    tenantId: "fh-demo",
    callId: sessionId,
    canonicalText: "May I have the name of the person who passed away?",
  });

  const { event } = await service.recordCallerLanguageOutput({
    tenantId: "fh-demo",
    sessionId,
    provider: "twilio_conversation_relay",
    outcome,
  });

  assert.equal(event.eventType, "TTS_STARTED");
  assert.equal(event.payload.languageMode, "reviewed");
  assert.equal(event.payload.languageStatus, "reviewed");
  assert.equal(event.payload.languageProvider, "reviewed_bundle");
  assert.equal(event.payload.bundleVersion, REVIEWED_CALLER_LANGUAGE_BUNDLE_VERSION);
  assert.equal(event.payload.cacheHit, true);
  assert.equal(event.payload.totalTokens, 0);
  assert.equal(event.payload.estimatedCostMicrousd, 0);
  assert.equal(event.payload.canonicalTextRetained, false);
  assert.equal(event.payload.generatedTextRetained, false);
  const serialized = JSON.stringify(event);
  assert.doesNotMatch(serialized, /When you are ready|person who passed away/);
});
