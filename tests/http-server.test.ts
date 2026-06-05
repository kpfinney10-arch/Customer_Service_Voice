import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirstCallService } from "../src/api/first-call-service.js";
import { handleApiRequest } from "../src/api/http-server.js";
import { InMemoryEventStore } from "../src/events/in-memory-event-store.js";
import { InMemoryTenantApiKeyVerifier } from "../src/security/tenant-auth.js";
import { InMemorySessionStore } from "../src/session/in-memory-session-store.js";
import { InMemoryTenantConfigStore } from "../src/tenants/tenant-config.js";

test("health endpoint reports ready", async () => {
  const response = await fetchJson("GET", "/health");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
});

test("tenant config endpoint returns authenticated tenant configuration", async () => {
  const response = await fetchJson("GET", "/v1/tenants/fh-crm-only/config");

  assert.equal(response.status, 200);
  assert.equal(response.body.tenantConfig.tenantId, "fh-crm-only");
  assert.equal(response.body.tenantConfig.displayName, "CRM Only Funeral Home");
  assert.equal(response.body.tenantConfig.handoff.onCallPhone, "+15555550200");
  assert.equal(response.body.tenantConfig.features.voiceIntake, true);
  assert.equal(response.body.tenantConfig.features.dispatchHandoff, false);
});

test("tenant config endpoint requires tenant API key and known config", async () => {
  const missingKey = await fetchJson("GET", "/v1/tenants/fh-demo/config", undefined, { apiKey: null });

  assert.equal(missingKey.status, 401);
  assert.equal(missingKey.body.error, "API_KEY_REQUIRED");

  const missingConfig = await fetchJson("GET", "/v1/tenants/fh-auth-only/config");

  assert.equal(missingConfig.status, 404);
  assert.equal(missingConfig.body.error, "TENANT_CONFIG_NOT_FOUND");
});

test("first-call API starts a session and handles transcript turn", async () => {
  const started = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    callId: "call-api-1",
    sessionId: "session-api-1",
    callerPhone: "555-111-2222",
  });

  assert.equal(started.status, 201);
  assert.equal(started.body.session.callId, "call-api-1");
  assert.equal(started.body.session.tenantId, "fh-demo");
  assert.equal(started.body.events[0].eventType, "CALL_STARTED");

  const transcript =
    "My name is Sarah Miller, my father Robert Miller passed away at 123 Maple Street, Springfield. My number is 555-111-2222.";
  const turn = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-api-1/transcript", {
    transcript,
    correlationId: "corr-api-1",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.currentState, "ESCALATE");
  assert.equal(turn.body.session.facts.caller_name, "Sarah Miller");
  assert.equal(turn.body.session.facts.decedent_name, "Robert Miller");
  assert.equal(turn.body.decision.step, "escalate");
  assert.equal(turn.body.handoff.handoffType, "human_escalation");
  assert.equal(turn.body.handoff.priority, "urgent");
  assert.equal(turn.body.handoff.caller.name, "Sarah Miller");
  assert.equal(turn.body.handoff.caller.phone, "555-111-2222");
  assert.equal(turn.body.handoff.decedent.name, "Robert Miller");
  assert.equal(turn.body.handoff.location.pickupAddress, "123 Maple Street, Springfield");
  assert.equal(turn.body.handoffRouting.destinationType, "on_call_phone");
  assert.equal(turn.body.handoffRouting.destination, "+15555550100");
  assert.equal(turn.body.handoffRouting.queue, "first-call-after-hours");
  assert.equal(turn.body.handoffRouting.priority, "urgent");
  assert.deepEqual(turn.body.handoff.completedToolNames, [
    "crm.create_intake_lead",
    "dispatch.create_removal_request",
  ]);
  assert.deepEqual(turn.body.decision.toolNames, [
    "crm.create_intake_lead",
    "dispatch.create_removal_request",
  ]);
  assert.equal(turn.body.toolResults.length, 2);
  assert.deepEqual(
    turn.body.events.map((event: { eventType: string }) => event.eventType),
    [
      "TRANSCRIPT_RECEIVED",
      "INTENT_DETECTED",
      "ESCALATION_TRIGGERED",
      "TOOL_REQUESTED",
      "TOOL_EXECUTED",
      "TOOL_REQUESTED",
      "TOOL_EXECUTED",
    ],
  );

  const timeline = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/session-api-1/events");

  assert.equal(timeline.status, 200);
  assert.deepEqual(
    timeline.body.events.map((event: { eventType: string }) => event.eventType),
    [
      "CALL_STARTED",
      "TRANSCRIPT_RECEIVED",
      "INTENT_DETECTED",
      "ESCALATION_TRIGGERED",
      "TOOL_REQUESTED",
      "TOOL_EXECUTED",
      "TOOL_REQUESTED",
      "TOOL_EXECUTED",
    ],
  );

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/session-api-1/replay");

  assert.equal(replay.status, 200);
  assert.equal(replay.body.snapshot.currentState, "ESCALATE");
  assert.equal(replay.body.snapshot.eventCount, 8);
  assert.equal(replay.body.snapshot.latestEventType, "TOOL_EXECUTED");
  assert.equal(replay.body.snapshot.escalated, true);
  assert.equal(replay.body.snapshot.redactedTranscriptCount, 1);
  assert.deepEqual(replay.body.snapshot.completedToolNames, [
    "crm.create_intake_lead",
    "dispatch.create_removal_request",
  ]);
  assert.deepEqual(replay.body.snapshot.failedToolNames, []);
  assert.equal(replay.body.snapshot.handoff.caller.name, "Sarah Miller");
});

test("telephony inbound-call route starts first-call session", async () => {
  const inbound = await fetchJson("POST", "/v1/tenants/fh-demo/telephony/generic/inbound-call", {
    providerCallId: "provider-call-1",
    fromPhone: "555-888-9999",
    toPhone: "555-000-1111",
    correlationId: "corr-provider-1",
  });

  assert.equal(inbound.status, 201);
  assert.equal(inbound.body.provider, "generic");
  assert.equal(inbound.body.providerCallId, "provider-call-1");
  assert.equal(inbound.body.route, "first_call_intake");
  assert.equal(inbound.body.nextExpectedInput, "caller_speech");
  assert.equal(inbound.body.responseText, "I am sorry. I will help get this to the right person.");
  assert.deepEqual(inbound.body.voiceResponse.actions, [
    { type: "say", text: "I am sorry. I will help get this to the right person." },
    { type: "listen", expectedInput: "caller_speech" },
  ]);
  assert.equal(inbound.body.session.callId, "provider-call-1");
  assert.equal(inbound.body.session.sessionId, "provider-call-1");
  assert.equal(inbound.body.session.callerPhone, "555-888-9999");
  assert.equal(inbound.body.events[0].eventType, "CALL_STARTED");

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/provider-call-1/replay");

  assert.equal(replay.status, 200);
  assert.equal(replay.body.snapshot.eventCount, 1);
  assert.equal(replay.body.snapshot.currentState, "GREETING");

  const speechTurn = await fetchJson("POST", "/v1/tenants/fh-demo/telephony/generic/calls/provider-call-1/speech-turn", {
    transcript:
      "This is Michael Turner. My mother Helen Turner passed away at 456 Oak Road, Austin. My number is 555-888-9999.",
    confidence: 0.94,
    isFinal: true,
    correlationId: "corr-provider-2",
  });

  assert.equal(speechTurn.status, 200);
  assert.equal(speechTurn.body.provider, "generic");
  assert.equal(speechTurn.body.providerCallId, "provider-call-1");
  assert.equal(speechTurn.body.nextExpectedInput, "human_handoff");
  assert.equal(speechTurn.body.responseText, "I am going to connect you with a funeral home team member now.");
  assert.deepEqual(speechTurn.body.voiceResponse.actions, [
    { type: "say", text: "I am going to connect you with a funeral home team member now." },
    { type: "handoff", reason: "urgent_death_report" },
  ]);
  assert.equal(speechTurn.body.session.currentState, "ESCALATE");
  assert.equal(speechTurn.body.handoff.caller.name, "Michael Turner");
  assert.equal(speechTurn.body.handoff.decedent.name, "Helen Turner");
  assert.equal(speechTurn.body.handoffRouting.destinationType, "on_call_phone");
  assert.equal(speechTurn.body.handoffRouting.destination, "+15555550100");
  assert.deepEqual(speechTurn.body.decision.toolNames, [
    "crm.create_intake_lead",
    "dispatch.create_removal_request",
  ]);

  const ended = await fetchJson("POST", "/v1/tenants/fh-demo/telephony/generic/calls/provider-call-1/end", {
    reason: "human_handoff_completed",
    correlationId: "corr-provider-3",
  });

  assert.equal(ended.status, 200);
  assert.equal(ended.body.ended, true);
  assert.equal(ended.body.session.currentState, "END_CALL");
  assert.equal(ended.body.events[0].eventType, "CALL_ENDED");
  assert.deepEqual(ended.body.voiceResponse.actions, [
    { type: "hangup", reason: "human_handoff_completed" },
  ]);

  const completedReplay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/provider-call-1/replay");

  assert.equal(completedReplay.status, 200);
  assert.equal(completedReplay.body.snapshot.currentState, "END_CALL");
  assert.equal(completedReplay.body.snapshot.latestEventType, "CALL_ENDED");
});

test("telephony audio-turn route transcribes audio and synthesizes response audio", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/telephony/generic/inbound-call", {
    providerCallId: "provider-call-audio-1",
    fromPhone: "555-222-1010",
  });

  const audioTranscript =
    "This is Daniel Stone. My father George Stone passed away at 789 Pine Road, Dallas. My number is 555-222-1010.";
  const audioTurn = await fetchJson("POST", "/v1/tenants/fh-demo/telephony/generic/calls/provider-call-audio-1/audio-turn", {
    audioContentType: "audio/wav",
    audioBytesBase64: Buffer.from(audioTranscript, "utf8").toString("base64"),
    languageCode: "en-US",
    voice: "local-test",
    correlationId: "corr-audio-1",
  });

  assert.equal(audioTurn.status, 200);
  assert.equal(audioTurn.body.stt.provider, "fake-stt");
  assert.equal(audioTurn.body.stt.transcript, audioTranscript);
  assert.equal(audioTurn.body.tts.provider, "fake-tts");
  assert.equal(
    Buffer.from(audioTurn.body.tts.audio.bytesBase64, "base64").toString("utf8"),
    "I am going to connect you with a funeral home team member now.",
  );
  assert.equal(audioTurn.body.nextExpectedInput, "human_handoff");
  assert.equal(audioTurn.body.handoff.caller.name, "Daniel Stone");
  assert.equal(audioTurn.body.handoff.decedent.name, "George Stone");
  assert.equal(audioTurn.body.handoffRouting.destinationType, "on_call_phone");
});

test("telephony interrupt route records barge-in and resumes listening", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/telephony/generic/inbound-call", {
    providerCallId: "provider-call-interrupt-1",
    fromPhone: "555-444-2020",
  });

  const interrupted = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/telephony/generic/calls/provider-call-interrupt-1/interrupt",
    {
      reason: "caller_barged_in",
      interruptedOutput: "I am sorry. I will help get this to the right person.",
      correlationId: "corr-interrupt-1",
    },
  );

  assert.equal(interrupted.status, 200);
  assert.equal(interrupted.body.interrupted, true);
  assert.equal(interrupted.body.responseText, "Go ahead. I am listening.");
  assert.equal(interrupted.body.session.retryCount, 1);
  assert.deepEqual(interrupted.body.voiceResponse.actions, [
    { type: "stop", target: "current_output" },
    { type: "say", text: "Go ahead. I am listening." },
    { type: "listen", expectedInput: "caller_speech" },
  ]);

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/provider-call-interrupt-1/replay");

  assert.equal(replay.status, 200);
  assert.equal(replay.body.snapshot.interruptionCount, 1);
  assert.equal(replay.body.snapshot.latestEventType, "CALL_INTERRUPTED");
});

test("first-call transcript endpoint validates required transcript", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-api-2",
  });

  const response = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-api-2/transcript", {});

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "VALIDATION_ERROR");
});

test("first-call API omits handoff before escalation", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-api-3",
  });

  const turn = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-api-3/transcript", {
    transcript: "My name is Emily Carter and my number is 555-333-4444.",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.currentState, "RESOLVE_REQUEST");
  assert.equal(turn.body.decision.step, "collect_decedent");
  assert.equal(turn.body.handoff, undefined);
  assert.equal(turn.body.handoffRouting, undefined);
});

test("first-call API skips disabled tenant handoff tools", async () => {
  await fetchJson("POST", "/v1/tenants/fh-crm-only/first-call/sessions", {
    sessionId: "session-crm-only-1",
  });

  const turn = await fetchJson("POST", "/v1/tenants/fh-crm-only/first-call/sessions/session-crm-only-1/transcript", {
    transcript:
      "My name is Laura Fields. My father Thomas Fields passed away at 900 Cedar Lane, Tulsa. My number is 555-777-1212.",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.currentState, "ESCALATE");
  assert.deepEqual(turn.body.toolResults.map((result: { toolName: string }) => result.toolName), [
    "crm.create_intake_lead",
  ]);
  assert.deepEqual(
    turn.body.events.map((event: { eventType: string }) => event.eventType),
    [
      "TRANSCRIPT_RECEIVED",
      "INTENT_DETECTED",
      "ESCALATION_TRIGGERED",
      "TOOL_REQUESTED",
      "TOOL_EXECUTED",
      "TOOL_SKIPPED",
    ],
  );
  assert.equal(turn.body.events.at(-1).payload.toolName, "dispatch.create_removal_request");
  assert.equal(turn.body.handoff.completedToolNames.length, 1);
  assert.equal(turn.body.handoffRouting.destination, "+15555550200");
});

test("tenant voice intake feature flag blocks new intake sessions", async () => {
  const firstCall = await fetchJson("POST", "/v1/tenants/fh-disabled/first-call/sessions", {
    sessionId: "session-disabled-1",
  });

  assert.equal(firstCall.status, 403);
  assert.equal(firstCall.body.error, "TENANT_FEATURE_DISABLED");

  const inbound = await fetchJson("POST", "/v1/tenants/fh-disabled/telephony/generic/inbound-call", {
    providerCallId: "provider-disabled-1",
    fromPhone: "555-999-0000",
  });

  assert.equal(inbound.status, 403);
  assert.equal(inbound.body.error, "TENANT_FEATURE_DISABLED");
});

test("tenant routes require an API key", async () => {
  const missing = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {}, { apiKey: null });

  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, "API_KEY_REQUIRED");

  const wrong = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {}, { apiKey: "wrong-key" });

  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error, "API_KEY_FORBIDDEN");
});

async function fetchJson(
  method: string,
  path: string,
  body?: object,
  options: { apiKey?: string | null } = {},
): Promise<{ status: number; body: any }> {
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  const apiKey = options.apiKey === undefined ? "demo-api-key" : options.apiKey;
  if (apiKey) headers["x-api-key"] = apiKey;
  if (body) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (Object.keys(headers).length > 0) init.headers = headers;
  const service = createFirstCallService({
    store: sharedStore,
    eventStore: sharedEventStore,
    tenantConfigStore: sharedTenantConfigStore,
  });
  const response = await handleApiRequest(
    service,
    new Request(`http://localhost${path}`, init),
    apiKeyVerifier,
    undefined,
    sharedTenantConfigStore,
  );
  return {
    status: response.status,
    body: await response.json(),
  };
}

const sharedStore = new InMemorySessionStore();
const sharedEventStore = new InMemoryEventStore();
const sharedTenantConfigStore = new InMemoryTenantConfigStore({
  "fh-demo": {
    tenantId: "fh-demo",
    displayName: "Demo Funeral Home",
    timezone: "America/Chicago",
    handoff: {
      defaultQueue: "first-call-dispatch",
      onCallPhone: "+15555550100",
      dispatchDeskPhone: "+15555550101",
      afterHoursQueue: "first-call-after-hours",
    },
    features: {
      crmHandoff: true,
      dispatchHandoff: true,
      voiceIntake: true,
    },
  },
  "fh-crm-only": {
    tenantId: "fh-crm-only",
    displayName: "CRM Only Funeral Home",
    timezone: "America/Chicago",
    handoff: {
      defaultQueue: "crm-only-first-call",
      onCallPhone: "+15555550200",
    },
    features: {
      crmHandoff: true,
      dispatchHandoff: false,
      voiceIntake: true,
    },
  },
  "fh-disabled": {
    tenantId: "fh-disabled",
    displayName: "Disabled Funeral Home",
    timezone: "America/Chicago",
    handoff: {
      defaultQueue: "disabled-first-call",
      onCallPhone: "+15555550300",
    },
    features: {
      crmHandoff: false,
      dispatchHandoff: false,
      voiceIntake: false,
    },
  },
});
const apiKeyVerifier = new InMemoryTenantApiKeyVerifier({
  "fh-demo": "demo-api-key",
  "fh-crm-only": "demo-api-key",
  "fh-disabled": "demo-api-key",
  "fh-auth-only": "demo-api-key",
});
