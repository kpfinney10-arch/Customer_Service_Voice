import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirstCallService } from "../src/api/first-call-service.js";
import { handleApiRequest } from "../src/api/http-server.js";
import { InMemoryEventStore } from "../src/events/in-memory-event-store.js";
import type { ApiRequestLog, Logger } from "../src/observability/logger.js";
import { InMemoryIdempotencyStore } from "../src/security/idempotency.js";
import type { IdempotencyStore } from "../src/security/idempotency.js";
import { InMemoryRateLimiter } from "../src/security/rate-limit.js";
import type { RateLimiter } from "../src/security/rate-limit.js";
import { InMemoryTenantApiKeyVerifier } from "../src/security/tenant-auth.js";
import {
  createTwilioWebhookSignature,
  createWebhookSignature,
  HmacWebhookSignatureVerifier,
} from "../src/security/webhook-signature.js";
import type { WebhookSignatureVerifier } from "../src/security/webhook-signature.js";
import { InMemorySessionStore } from "../src/session/in-memory-session-store.js";
import { InMemoryTenantConfigStore } from "../src/tenants/tenant-config.js";
import type { TelnyxCallControlClient } from "../src/providers/telephony/telnyx-client.js";
import type { TelnyxReadiness } from "../src/providers/telephony/telnyx-readiness.js";
import type { TwilioReadiness } from "../src/providers/telephony/twilio-readiness.js";
import type { FirstCallExtractor } from "../src/verticals/funeral-home/first-call-extractor.js";

test("health endpoint reports ready", async () => {
  const response = await fetchJson("GET", "/health");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
});

test("version endpoint reports build metadata without tenant auth", async () => {
  const response = await fetchJson("GET", "/version", undefined, {
    apiKey: null,
    requestId: "req-version-1",
  });

  assert.equal(response.status, 200);
  assert.equal(response.requestId, "req-version-1");
  assert.deepEqual(response.body.build, {
    serviceName: "voice-ai-platform",
    version: "test-version",
    commit: "test-commit",
    buildTime: "2026-06-06T12:00:00.000Z",
  });
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

test("tenant readiness endpoint reports ready and blocked tenants", async () => {
  const ready = await fetchJson("GET", "/v1/tenants/fh-demo/readiness");

  assert.equal(ready.status, 200);
  assert.equal(ready.body.readiness.tenantId, "fh-demo");
  assert.equal(ready.body.readiness.ready, true);
  assert.equal(ready.body.readiness.checks.every((check: { ok: boolean }) => check.ok), true);

  const blocked = await fetchJson("GET", "/v1/tenants/fh-disabled/readiness");

  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.readiness.ready, false);
  assert.equal(
    blocked.body.readiness.checks.find((check: { name: string }) => check.name === "voice_intake_enabled").ok,
    false,
  );
});

test("Telnyx readiness endpoint returns tenant and provider preflight status", async () => {
  const response = await fetchJson("GET", "/v1/tenants/fh-demo/telephony/telnyx/readiness", undefined, {
    telnyxReadiness: {
      provider: "telnyx",
      mode: "live",
      readyForDryRun: true,
      readyForLiveTraffic: true,
      checks: [
        {
          name: "webhook_signature_configured",
          ok: true,
          severity: "info",
          message: "Telnyx webhook signature verification is configured.",
        },
      ],
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.tenantReadiness.tenantId, "fh-demo");
  assert.equal(response.body.tenantReadiness.ready, true);
  assert.equal(response.body.telnyxReadiness.provider, "telnyx");
  assert.equal(response.body.telnyxReadiness.mode, "live");
  assert.equal(response.body.telnyxReadiness.readyForLiveTraffic, true);
  assert.equal(response.body.telnyxReadiness.checks[0].name, "webhook_signature_configured");
});

test("Twilio readiness endpoint returns tenant and provider preflight status", async () => {
  const response = await fetchJson("GET", "/v1/tenants/fh-demo/telephony/twilio/readiness", undefined, {
    twilioReadiness: {
      provider: "twilio",
      mode: "signed_webhook",
      readyForLocalTesting: true,
      readyForPublicTraffic: true,
      checks: [
        {
          name: "webhook_signature_configured",
          ok: true,
          severity: "info",
          message: "Twilio webhook signature verification is configured.",
        },
      ],
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.tenantReadiness.tenantId, "fh-demo");
  assert.equal(response.body.tenantReadiness.ready, true);
  assert.equal(response.body.twilioReadiness.provider, "twilio");
  assert.equal(response.body.twilioReadiness.mode, "signed_webhook");
  assert.equal(response.body.twilioReadiness.readyForPublicTraffic, true);
  assert.equal(response.body.twilioReadiness.checks[0].name, "webhook_signature_configured");
});

test("tenant diagnostics activity endpoint returns authenticated recent summaries", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    callId: "call-diagnostics-1",
    sessionId: "session-diagnostics-1",
    callerPhone: "555-212-3434",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-diagnostics-1/transcript", {
    transcript:
      "My name is Angela Carter. My uncle David Carter passed away at 100 Pine Street, Tulsa. My phone is 555-212-3434.",
    correlationId: "corr-diagnostics-1",
  });

  const response = await fetchJson("GET", "/v1/tenants/fh-demo/diagnostics/activity?limit=5");

  assert.equal(response.status, 200);
  assert.equal(response.body.tenantId, "fh-demo");
  assert.equal(response.body.limit, 5);
  assert.equal(
    response.body.sessions.some((session: { sessionId: string }) => session.sessionId === "session-diagnostics-1"),
    true,
  );
  assert.equal(
    response.body.recentEvents.some((event: { eventType: string }) => event.eventType === "TRANSCRIPT_RECEIVED"),
    true,
  );
  assert.equal("payload" in response.body.recentEvents[0], false);
});

test("tenant diagnostics activity endpoint requires auth and validates limit", async () => {
  const missingKey = await fetchJson("GET", "/v1/tenants/fh-demo/diagnostics/activity", undefined, {
    apiKey: null,
  });
  const invalidLimit = await fetchJson("GET", "/v1/tenants/fh-demo/diagnostics/activity?limit=zero");

  assert.equal(missingKey.status, 401);
  assert.equal(missingKey.body.error, "API_KEY_REQUIRED");
  assert.equal(invalidLimit.status, 400);
  assert.equal(invalidLimit.body.error, "VALIDATION_ERROR");
});

test("API request logging captures request metadata without request bodies", async () => {
  const logger = new TestLogger();
  const response = await fetchJson("GET", "/v1/tenants/fh-demo/config", undefined, {
    requestId: "req-config-1",
    logger,
  });

  assert.equal(response.status, 200);
  assert.equal(response.requestId, "req-config-1");
  assert.equal(logger.requests.length, 1);
  assert.equal(logger.requests[0]?.requestId, "req-config-1");
  assert.equal(logger.requests[0]?.method, "GET");
  assert.equal(logger.requests[0]?.path, "/v1/tenants/fh-demo/config");
  assert.equal(logger.requests[0]?.tenantId, "fh-demo");
  assert.equal(logger.requests[0]?.statusCode, 200);
  assert.equal(typeof logger.requests[0]?.durationMs, "number");
  assert.equal("transcript" in (logger.requests[0] ?? {}), false);
});

test("API request logging includes error code for failed requests", async () => {
  const logger = new TestLogger();
  const response = await fetchJson("GET", "/v1/tenants/fh-demo/config", undefined, {
    apiKey: null,
    requestId: "req-missing-key-1",
    logger,
  });

  assert.equal(response.status, 401);
  assert.equal(response.requestId, "req-missing-key-1");
  assert.equal(logger.requests[0]?.statusCode, 401);
  assert.equal(logger.requests[0]?.errorCode, "API_KEY_REQUIRED");
});

test("tenant routes return 429 when rate limit is exceeded", async () => {
  const logger = new TestLogger();
  const rateLimiter = new InMemoryRateLimiter({
    limit: 1,
    windowMs: 60_000,
    now: () => 1_000,
  });

  const first = await fetchJson("GET", "/v1/tenants/fh-demo/config", undefined, {
    rateLimiter,
    logger,
  });
  const second = await fetchJson("GET", "/v1/tenants/fh-demo/config", undefined, {
    rateLimiter,
    logger,
  });

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.body.error, "RATE_LIMIT_EXCEEDED");
  assert.equal(second.headers["retry-after"], "60");
  assert.equal(second.headers["x-rate-limit-limit"], "1");
  assert.equal(logger.requests.at(-1)?.errorCode, "RATE_LIMIT_EXCEEDED");
});

test("POST routes replay matching idempotency keys", async () => {
  const idempotencyStore = new InMemoryIdempotencyStore();
  const body = {
    callId: "call-idempotent-1",
    sessionId: "session-idempotent-1",
    callerPhone: "555-333-4444",
  };

  const first = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", body, {
    idempotencyKey: "idem-session-1",
    idempotencyStore,
  });
  const second = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", body, {
    idempotencyKey: "idem-session-1",
    idempotencyStore,
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.headers["x-idempotency-status"], "stored");
  assert.equal(second.headers["x-idempotency-status"], "replayed");
  assert.deepEqual(second.body, first.body);
});

test("POST routes omit idempotency status when no key is provided", async () => {
  const response = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    callId: "call-no-idempotency-header-1",
    sessionId: "session-no-idempotency-header-1",
  });

  assert.equal(response.status, 201);
  assert.equal(response.headers["x-idempotency-status"], undefined);
});

test("POST routes reject idempotency key reuse for different requests", async () => {
  const idempotencyStore = new InMemoryIdempotencyStore();

  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions",
    {
      callId: "call-idempotent-conflict-1",
      sessionId: "session-idempotent-conflict-1",
    },
    {
      idempotencyKey: "idem-conflict-1",
      idempotencyStore,
    },
  );
  const conflict = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions",
    {
      callId: "call-idempotent-conflict-2",
      sessionId: "session-idempotent-conflict-2",
    },
    {
      idempotencyKey: "idem-conflict-1",
      idempotencyStore,
    },
  );

  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, "IDEMPOTENCY_KEY_CONFLICT");
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
  assert.equal(
    inbound.body.responseText,
    "I am assisting the funeral director with gathering call information. May I have your name and the best phone number in case we are disconnected?",
  );
  assert.deepEqual(inbound.body.voiceResponse.actions, [
    {
      type: "say",
      text: "I am assisting the funeral director with gathering call information. May I have your name and the best phone number in case we are disconnected?",
    },
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
    {
      type: "handoff",
      reason: "urgent_death_report",
      destinationType: "on_call_phone",
      destination: "+15555550100",
      queue: "first-call-after-hours",
    },
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

test("telephony routes reject missing webhook signature when provider secret is configured", async () => {
  const response = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/telephony/generic/inbound-call",
    {
      providerCallId: "provider-signed-missing-1",
      fromPhone: "555-888-9999",
    },
    {
      webhookSignatureVerifier: new HmacWebhookSignatureVerifier({
        generic: "secret-1",
      }),
    },
  );

  assert.equal(response.status, 401);
  assert.equal(response.body.error, "WEBHOOK_SIGNATURE_INVALID");
});

test("telephony routes accept valid webhook signatures", async () => {
  const path = "/v1/tenants/fh-demo/telephony/generic/inbound-call";
  const body = {
    providerCallId: "provider-signed-valid-1",
    fromPhone: "555-888-9999",
  };
  const rawBody = JSON.stringify(body);
  const response = await fetchJson("POST", path, body, {
    webhookSignatureVerifier: new HmacWebhookSignatureVerifier({
      generic: "secret-1",
    }),
    extraHeaders: {
      "x-webhook-signature": createWebhookSignature({
        secret: "secret-1",
        method: "POST",
        path,
        rawBody,
      }),
    },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.providerCallId, "provider-signed-valid-1");
});

test("Telnyx webhook route starts first-call session without tenant API key and returns command plan", async () => {
  const response = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/telephony/telnyx/webhook",
    {
      data: {
        id: "telnyx-event-1",
        event_type: "call.initiated",
        payload: {
          call_control_id: "telnyx-call-http-1",
          from: "+15551230000",
          to: "+15559870000",
        },
      },
    },
    {
      apiKey: null,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.provider, "telnyx");
  assert.equal(response.body.eventType, "call.initiated");
  assert.equal(response.body.result.providerCallId, "telnyx-call-http-1");
  assert.equal(response.body.result.session.sessionId, "telnyx-call-http-1");
  assert.equal(response.body.telnyxCommands[0].command, "answer");
  assert.equal(response.body.telnyxCommands[0].callControlId, "telnyx-call-http-1");
  assert.equal(response.body.telnyxCommands[1].command, "gather_using_speak");
  assert.equal(response.body.telnyxCommandResults[0].responseBody.dryRun, true);
  assert.equal(typeof response.body.providerCommandEventId, "string");

  const events = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/telnyx-call-http-1/events");
  const providerEvent = events.body.events.find(
    (event: { eventType: string }) => event.eventType === "PROVIDER_COMMANDS_EXECUTED",
  );
  assert.equal(providerEvent.eventId, response.body.providerCommandEventId);
  assert.equal(providerEvent.payload.provider, "telnyx");
  assert.equal(providerEvent.payload.providerEventType, "call.initiated");
  assert.deepEqual(providerEvent.payload.commandNames, ["answer", "gather_using_speak"]);
  assert.equal(providerEvent.payload.allSucceeded, true);
  assert.equal(providerEvent.payload.commandResults[0].dryRun, true);

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/telnyx-call-http-1/replay");
  assert.equal(replay.body.snapshot.providerCommandBatches.length, 1);
  assert.equal(replay.body.snapshot.providerCommandBatches[0].provider, "telnyx");
  assert.equal(replay.body.snapshot.providerCommandBatches[0].providerEventType, "call.initiated");
  assert.deepEqual(replay.body.snapshot.providerCommandBatches[0].commandNames, ["answer", "gather_using_speak"]);
  assert.equal(replay.body.snapshot.providerCommandBatches[0].allSucceeded, true);
  assert.equal(replay.body.snapshot.providerCommandBatches[0].commandResults[0].dryRun, true);
});

test("Telnyx webhook route records sanitized command failure summaries", async () => {
  const response = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/telephony/telnyx/webhook",
    {
      data: {
        id: "telnyx-event-failure-1",
        event_type: "call.initiated",
        payload: {
          call_control_id: "telnyx-call-http-failure-1",
          from: "+15551230000",
          to: "+15559870000",
        },
      },
    },
    {
      telnyxClient: {
        execute: async (commands) =>
          commands.map((command) => ({
            command: command.command,
            callControlId: command.callControlId,
            ok: false,
            statusCode: 422,
            responseBody: {
              errors: [
                {
                  message: "Call control id is no longer active.",
                },
              ],
            },
          })),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.telnyxCommandResults[0].ok, false);

  const events = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/telnyx-call-http-failure-1/events");
  const providerEvent = events.body.events.find(
    (event: { eventType: string }) => event.eventType === "PROVIDER_COMMANDS_EXECUTED",
  );
  assert.equal(providerEvent.payload.allSucceeded, false);
  assert.deepEqual(providerEvent.payload.failedCommandNames, ["answer", "gather_using_speak"]);
  assert.equal(providerEvent.payload.commandResults[0].failureSummary, "Call control id is no longer active.");

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/telnyx-call-http-failure-1/replay");
  assert.equal(replay.body.snapshot.providerCommandBatches[0].allSucceeded, false);
  assert.equal(
    replay.body.snapshot.providerCommandBatches[0].commandResults[0].failureSummary,
    "Call control id is no longer active.",
  );
});

test("Telnyx webhook route ignores unsupported events", async () => {
  const response = await fetchJson("POST", "/v1/tenants/fh-demo/telephony/telnyx/webhook", {
    data: {
      event_type: "call.speak.ended",
      payload: {
        call_control_id: "telnyx-call-http-ignored-1",
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.provider, "telnyx");
  assert.equal(response.body.eventType, "call.speak.ended");
  assert.equal(response.body.ignored, true);
});

test("Telnyx webhook route advances speech gather events through first-call workflow", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/telephony/telnyx/webhook", {
    data: {
      id: "telnyx-event-speech-start-1",
      event_type: "call.initiated",
      payload: {
        call_control_id: "telnyx-call-http-speech-1",
        from: "+15551230000",
        to: "+15559870000",
      },
    },
  });

  const response = await fetchJson("POST", "/v1/tenants/fh-demo/telephony/telnyx/webhook", {
    data: {
      id: "telnyx-event-speech-1",
      event_type: "call.ai_gather.ended",
      payload: {
        call_control_id: "telnyx-call-http-speech-1",
        message_history: [
          {
            role: "assistant",
            content:
              "I am assisting the funeral director with gathering call information. May I have your name and the best phone number in case we are disconnected?",
          },
          {
            role: "user",
            content:
              "My name is Sarah Miller. My father Robert Miller passed away at 123 Maple Street, Springfield. My phone is 555-212-3434.",
          },
        ],
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.provider, "telnyx");
  assert.equal(response.body.eventType, "call.ai_gather.ended");
  assert.equal(response.body.result.providerCallId, "telnyx-call-http-speech-1");
  assert.equal(response.body.result.session.currentState, "ESCALATE");
  assert.equal(response.body.result.nextExpectedInput, "human_handoff");
  assert.equal(response.body.telnyxCommands[0].command, "speak");
});

test("Twilio webhook route starts first-call session without tenant API key and returns TwiML", async () => {
  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-1",
      From: "+15551230000",
      To: "+15559870000",
      CallStatus: "ringing",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "text/xml; charset=utf-8");
  assert.match(response.body, /<Gather /);
  assert.match(response.body, /actionOnEmptyResult="true"/);
  assert.match(response.body, /hints="[^"]*decedent name[^"]*address[^"]*hospice/);
  assert.match(
    response.body,
    /<Say>I am assisting the funeral director with gathering call information\. May I have your name/,
  );

  const events = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-1/events");
  assert.equal(events.body.events[0].eventType, "CALL_STARTED");
});

test("Twilio webhook route accepts valid Twilio signatures when configured", async () => {
  const path = "/v1/tenants/fh-demo/telephony/twilio/webhook";
  const body = new URLSearchParams({
    CallSid: "twilio-call-http-signed-1",
    From: "+15551230000",
    To: "+15559870000",
    CallStatus: "ringing",
  });
  const rawBody = body.toString();
  const url = `http://localhost${path}`;

  const response = await fetchText("POST", path, body, {
    apiKey: null,
    webhookSignatureVerifier: new HmacWebhookSignatureVerifier({
      twilio: "twilio-auth-token",
    }),
    extraHeaders: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": createTwilioWebhookSignature({
        authToken: "twilio-auth-token",
        url,
        rawBody,
      }),
    },
  });

  assert.equal(response.status, 200);
  assert.match(response.body, /<Response>/);
});

test("Twilio webhook route rejects missing Twilio signatures when configured", async () => {
  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-unsigned-1",
      From: "+15551230000",
      To: "+15559870000",
    }),
    {
      apiKey: null,
      webhookSignatureVerifier: new HmacWebhookSignatureVerifier({
        twilio: "twilio-auth-token",
      }),
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 401);
  assert.match(response.body, /WEBHOOK_SIGNATURE_INVALID/);
});

test("Twilio webhook route reprompts on empty speech callbacks", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-empty-1",
      From: "+15551230000",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-empty-1",
      CallStatus: "in-progress",
      SpeechResult: "",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /I am sorry, I did not catch that\. Please say that again\./);
  assert.match(response.body, /<Gather /);

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-empty-1/replay");
  assert.equal(replay.body.snapshot.eventCount, 1);
  assert.equal(replay.body.snapshot.latestEventType, "CALL_STARTED");
});

test("Twilio webhook route advances speech callbacks through first-call workflow", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-speech-1",
      From: "+15551230000",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-speech-1",
      SpeechResult:
        "My name is Sarah Miller. My father Robert Miller passed away at 123 Maple Street, Springfield. My phone is 555-212-3434.",
      Confidence: "0.92",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.body,
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>I am going to connect you with a funeral home team member now.</Say><Dial timeout="25" answerOnBridge="true"><Number url="/v1/tenants/fh-demo/telephony/twilio/handoff-screen" method="POST">+15555550100</Number></Dial></Response>',
  );

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-speech-1/replay");
  assert.equal(replay.body.snapshot.currentState, "ESCALATE");
  assert.equal(replay.body.snapshot.latestEventType, "TOOL_EXECUTED");

  const screening = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/handoff-screen",
    new URLSearchParams({
      CallSid: "outbound-called-party-1",
      ParentCallSid: "twilio-call-http-speech-1",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(screening.status, 200);
  assert.match(screening.body, /<Gather input="dtmf" numDigits="1"/);
  assert.match(screening.body, /Caller Sarah Miller/);
  assert.match(screening.body, /Deceased Robert Miller/);
  assert.match(screening.body, /Press 1 to accept this call/);

  const accepted = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/handoff-accept",
    new URLSearchParams({
      CallSid: "outbound-called-party-1",
      ParentCallSid: "twilio-call-http-speech-1",
      Digits: "1",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(accepted.status, 200);
  assert.equal(accepted.body, '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Connecting now.</Say></Response>');
});

test("Twilio webhook route closes routine pricing inquiries after contact capture", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-pricing-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const opening = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-pricing-1",
      SpeechResult:
        "Hi, I'm calling to ask about cremation pricing. No one has passed away right now. I'm just trying to understand your basic direct cremation cost and what is included.",
      Confidence: "0.92",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(opening.status, 200);
  assert.match(opening.body, /<Gather /);
  assert.match(opening.body, /May I have your name/);
  assert.doesNotMatch(opening.body, /person who passed away|located right now/i);

  const contact = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-pricing-1",
      SpeechResult: "My name is Kyle Smith. My callback number is 603-731-5845.",
      Confidence: "0.92",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(contact.status, 200);
  assert.match(contact.body, /follow up during office hours/);
  assert.match(contact.body, /<Hangup\/>/);
  assert.doesNotMatch(contact.body, /<Gather /);
  assert.doesNotMatch(contact.body, /<Dial/);

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-pricing-1/replay");
  assert.equal(replay.body.session.currentState, "WRAPUP");
  assert.equal(replay.body.session.intent, "pricing_or_billing");
  assert.equal(replay.body.session.facts.reasonForCall, "pricing_or_billing");
  assert.equal(replay.body.session.facts.death_reported, false);
  assert.equal(replay.body.session.facts.decedent_name, undefined);
  assert.deepEqual(replay.body.snapshot.completedToolNames, ["crm.create_intake_lead"]);
});

test("Twilio webhook route closes existing-family office-hours inquiries", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-family-office-hours-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-family-office-hours-1",
      SpeechResult:
        "Uh, hi. My name's Kyle finny. I'm calling about my father. Robert, finny funeral home is already helping our family. This is not a new death call, not an emergency. Just want to know what time the office opens up tomorrow, whether I can drop off clothing for him in the morning, my call back number is 603-731-5845.",
      Confidence: "0.92",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /follow up during office hours/);
  assert.match(response.body, /<Hangup\/>/);
  assert.doesNotMatch(response.body, /person who passed away|located right now/i);
  assert.doesNotMatch(response.body, /<Gather /);
  assert.doesNotMatch(response.body, /<Dial/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-family-office-hours-1/replay",
  );
  assert.equal(replay.body.session.currentState, "WRAPUP");
  assert.equal(replay.body.session.intent, "service_schedule_question");
  assert.equal(replay.body.session.facts.reasonForCall, "service_schedule_question");
  assert.equal(replay.body.session.facts.death_reported, false);
  assert.equal(replay.body.session.facts.urgency, "routine");
  assert.equal(replay.body.session.facts.caller_name, "Kyle Finny");
  assert.equal(replay.body.session.facts.caller_phone, "603-731-5845");
  assert.equal(replay.body.session.facts.decedent_name, "Robert Finny");
  assert.deepEqual(replay.body.snapshot.completedToolNames, ["crm.create_intake_lead"]);
});

test("Twilio webhook route closes live visitation schedule phrasing", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-family-visitation-live-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-family-visitation-live-1",
      SpeechResult:
        "Hi, my name is Kyle penny. I'm calling about my father Robert Finny, the funeral home is already helping our family. This is not a new death, call an emergency. I just wanted to confirm what time the visitation is tomorrow, whether the service is still scheduled for Friday. Morning my call back number is 603-731-5845.",
      Confidence: "0.92",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /follow up during office hours/);
  assert.match(response.body, /<Hangup\/>/);
  assert.doesNotMatch(response.body, /person who passed away|located right now/i);
  assert.doesNotMatch(response.body, /<Gather /);
  assert.doesNotMatch(response.body, /<Dial/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-family-visitation-live-1/replay",
  );
  assert.equal(replay.body.session.currentState, "WRAPUP");
  assert.equal(replay.body.session.intent, "service_schedule_question");
  assert.equal(replay.body.session.facts.reasonForCall, "service_schedule_question");
  assert.equal(replay.body.session.facts.death_reported, false);
  assert.equal(replay.body.session.facts.urgency, "routine");
  assert.equal(replay.body.session.facts.place_of_death_type, "unknown");
  assert.equal(replay.body.session.facts.decedent_name, "Robert Finny");
  assert.deepEqual(replay.body.snapshot.completedToolNames, ["crm.create_intake_lead"]);
});

test("Twilio webhook route closes routine director callback with repaired phone", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-family-director-callback-live-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-family-director-callback-live-1",
      SpeechResult:
        "Hi, my name is Kyle finny. I'm calling about my father. Robert finny, uh, the funeral home is already helping our family. This is not a new death call. Not an emergency. I don't need someone tonight, but I would like the funeral director to call me tomorrow about a question. I have on the arrangements, my call back number is 637315845.",
      Confidence: "0.92",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /follow up during office hours/);
  assert.match(response.body, /<Hangup\/>/);
  assert.doesNotMatch(response.body, /person who passed away|located right now/i);
  assert.doesNotMatch(response.body, /<Gather /);
  assert.doesNotMatch(response.body, /<Dial/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-family-director-callback-live-1/replay",
  );
  assert.equal(replay.body.session.currentState, "WRAPUP");
  assert.equal(replay.body.session.intent, "family_question");
  assert.equal(replay.body.session.facts.reasonForCall, "family_question");
  assert.equal(replay.body.session.facts.death_reported, false);
  assert.equal(replay.body.session.facts.urgency, "routine");
  assert.equal(replay.body.session.facts.place_of_death_type, "unknown");
  assert.equal(replay.body.session.facts.caller_phone, "603-731-5845");
  assert.equal(replay.body.session.facts.decedent_name, "Robert Finny");
  assert.deepEqual(replay.body.snapshot.completedToolNames, ["crm.create_intake_lead"]);
});

test("Twilio webhook route closes obituary and flower family inquiry", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-family-obituary-flower-live-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-family-obituary-flower-live-1",
      SpeechResult:
        "Hi, my name is Kyle finny, I'm calling about my father. Robert, Finny the funeral home is already helping out our family. It's not a new death call or an emergency. I just wanted to ask Um, how we submit obituary wording, uh, and whether flower delivery should go to the funeral home or the church. I can be reached at, I mean, my call back is 603-731-5845.",
      Confidence: "0.92",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /follow up during office hours/);
  assert.match(response.body, /<Hangup\/>/);
  assert.doesNotMatch(response.body, /person who passed away|located right now/i);
  assert.doesNotMatch(response.body, /<Gather /);
  assert.doesNotMatch(response.body, /<Dial/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-family-obituary-flower-live-1/replay",
  );
  assert.equal(replay.body.session.currentState, "WRAPUP");
  assert.equal(replay.body.session.intent, "family_question");
  assert.equal(replay.body.session.facts.reasonForCall, "family_question");
  assert.equal(replay.body.session.facts.death_reported, false);
  assert.equal(replay.body.session.facts.urgency, "routine");
  assert.equal(replay.body.session.facts.place_of_death_type, "unknown");
  assert.equal(replay.body.session.facts.caller_phone, "603-731-5845");
  assert.equal(replay.body.session.facts.decedent_name, "Robert Finny");
  assert.equal(
    replay.body.session.facts.special_handling_notes,
    "Routine family inquiry about obituary wording and flower delivery; caller requested office-hours follow-up.",
  );
  assert.deepEqual(replay.body.snapshot.completedToolNames, ["crm.create_intake_lead"]);
});

test("Twilio webhook route accepts compact caller name and phone answers", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-compact-caller-1",
      From: "+18179205700",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-compact-caller-1",
      SpeechResult: "Kyle 817-920-5700.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /May I have the name of the person who passed away\?/);
  assert.doesNotMatch(response.body, /May I have your name and the best phone number/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-compact-caller-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, "Kyle");
  assert.equal(replay.body.session.facts.caller_phone, "817-920-5700");
  assert.equal(replay.body.session.facts.pickup_contact_name, "Kyle");
});

test("Twilio webhook route accepts dotted spaced caller phone answers", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-spaced-phone-1",
      From: "+18179205700",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-spaced-phone-1",
      SpeechResult: "Ronald McDonald. My phone is  214.  623 5918.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /May I have the name of the person who passed away\?/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-spaced-phone-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, "Ronald McDonald");
  assert.equal(replay.body.session.facts.caller_phone, "214-623-5918");
});

test("Twilio webhook route asks for digit-by-digit confirmation on near phone answers", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-near-phone-1",
      From: "+18179205700",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-near-phone-1",
      SpeechResult: "My name is John Adams. I can be reached at 2554 431. 5762.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /Please say the best callback number one digit at a time/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-near-phone-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, "John Adams");
  assert.equal(replay.body.session.facts.caller_phone, undefined);
});

test("Twilio webhook route repairs one-missing-digit callback from matching caller ID", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-provider-phone-repair-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-provider-phone-repair-1",
      SpeechResult: "My name is Kyle Finney. My phone is 637315845.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /May I have the name of the person who passed away\?/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-provider-phone-repair-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, "Kyle Finney");
  assert.equal(replay.body.session.facts.caller_phone, "603-731-5845");
  const intentEvent = replay.body.events.find(
    (event: { eventType: string; payload: { warnings?: string[] } }) => event.eventType === "INTENT_DETECTED",
  );
  assert.equal(intentEvent.payload.warnings.includes("caller_phone_not_found"), false);
});

test("Twilio webhook route repairs bare one-missing-digit callback answers from matching caller ID", async () => {
  const repairCases: Array<[string, string]> = [
    ["digits-only", "637315845."],
    ["digits-with-filler", "637315845. Zero down. Okay."],
  ];
  for (const [suffix, speech] of repairCases) {
    const callSid = `twilio-call-http-provider-phone-repair-bare-${suffix}`;
    await fetchText(
      "POST",
      "/v1/tenants/fh-demo/telephony/twilio/webhook",
      new URLSearchParams({
        CallSid: callSid,
        From: "+16037315845",
        To: "+15559870000",
        CallStatus: "in-progress",
      }),
      {
        apiKey: null,
        extraHeaders: {
          "content-type": "application/x-www-form-urlencoded",
        },
      },
    );

    await fetchText(
      "POST",
      "/v1/tenants/fh-demo/telephony/twilio/webhook",
      new URLSearchParams({
        CallSid: callSid,
        SpeechResult: "My name is Kyle Finney.",
        Confidence: "0.91",
      }),
      {
        apiKey: null,
        extraHeaders: {
          "content-type": "application/x-www-form-urlencoded",
        },
      },
    );

    const response = await fetchText(
      "POST",
      "/v1/tenants/fh-demo/telephony/twilio/webhook",
      new URLSearchParams({
        CallSid: callSid,
        SpeechResult: speech,
        Confidence: "0.91",
      }),
      {
        apiKey: null,
        extraHeaders: {
          "content-type": "application/x-www-form-urlencoded",
        },
      },
    );

    assert.equal(response.status, 200);
    assert.match(response.body, /May I have the name of the person who passed away\?/);

    const replay = await fetchJson("GET", `/v1/tenants/fh-demo/first-call/sessions/${callSid}/replay`);
    assert.equal(replay.body.session.facts.caller_name, "Kyle Finney");
    assert.equal(replay.body.session.facts.caller_phone, "603-731-5845");
  }
});

test("Twilio webhook route does not accept conversational filler as caller name", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-filler-not-name-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-filler-not-name-1",
      SpeechResult: "Of course.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /May I have your name/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-filler-not-name-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, undefined);
  assert.equal(replay.body.session.facts.caller_phone, undefined);
});

test("Twilio webhook route repairs bare callback with conversational filler without accepting a name", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-filler-phone-repair-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-filler-phone-repair-1",
      SpeechResult: "Yes, of course. Um, 637315845.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /I have the callback number\. May I have your name\?/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-filler-phone-repair-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, undefined);
  assert.equal(replay.body.session.facts.caller_phone, "603-731-5845");

  const nameResponse = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-filler-phone-repair-1",
      SpeechResult: "yes, it's Kyle Finny",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(nameResponse.status, 200);
  assert.match(nameResponse.body, /I have the callback number/);
  assert.match(nameResponse.body, /Please spell your last name/);

  const nameReplay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-filler-phone-repair-1/replay",
  );
  assert.equal(nameReplay.body.session.facts.caller_name, "Kyle Finny");
  assert.equal(nameReplay.body.session.facts.caller_phone, "603-731-5845");
  assert.equal(nameReplay.body.session.facts.caller_name_spelling_status, "needs_confirmation");
});

test("Twilio webhook route repairs at-prefixed callback and keeps suspicious caller name", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-at-phone-repair-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-at-phone-repair-1",
      SpeechResult: "oh, my name is Kyle Finny at 637315845.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /I have the callback number/);
  assert.match(response.body, /Please spell your last name/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-at-phone-repair-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, "Kyle Finny");
  assert.equal(replay.body.session.facts.caller_phone, "603-731-5845");
  assert.equal(replay.body.session.facts.caller_name_spelling_status, "needs_confirmation");
});

test("Twilio webhook route keeps conjunction out of repaired caller name before phone cue", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-provider-phone-repair-name-boundary-1",
      From: "+16037315845",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-provider-phone-repair-name-boundary-1",
      SpeechResult: "My name is Kyle finny and my phone is 637315845.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /Please spell your last name/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-provider-phone-repair-name-boundary-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, "Kyle Finny");
  assert.equal(replay.body.session.facts.caller_phone, "603-731-5845");
  assert.equal(replay.body.session.facts.caller_name_spelling_status, "needs_confirmation");
});

test("Twilio webhook route does not repair malformed callback from nonmatching caller ID", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-provider-phone-repair-negative-1",
      From: "+18179205700",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-provider-phone-repair-negative-1",
      SpeechResult: "My name is Kyle Finney. My phone is 637315845.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /Please say the best callback number one digit at a time/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-provider-phone-repair-negative-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, "Kyle Finney");
  assert.equal(replay.body.session.facts.caller_phone, undefined);
});

test("Twilio webhook route does not overwrite caller name from invalid phone-only turns", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-invalid-phone-name-1",
      From: "+18179205700",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-invalid-phone-name-1",
      SpeechResult: "My name is Ronald Reagan.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-invalid-phone-name-1",
      SpeechResult: "I can be reached at 4 3, 9. 562 4521.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /Please say the best callback number one digit at a time/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-invalid-phone-name-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, "Ronald Reagan");
  assert.equal(replay.body.session.facts.caller_phone, undefined);
});

test("Twilio webhook route keeps noisy telephone cue words out of caller name", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-noisy-telephone-name-1",
      From: "+18179205700",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-noisy-telephone-name-1",
      SpeechResult: "My name is Bob. Television. My telephone is 214-363-4519.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /May I have the name of the person who passed away\?/);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-noisy-telephone-name-1/replay",
  );
  assert.equal(replay.body.session.facts.caller_name, "Bob");
  assert.equal(replay.body.session.facts.caller_phone, "214-363-4519");
});

test("Twilio webhook route accepts reverse caller name phrase and Circle address", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-circle-address-1",
      From: "+18179205700",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-circle-address-1",
      SpeechResult: "Charles McDaniels is my name, and my phone number is 432569. 4324.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-circle-address-1",
      SpeechResult: "Name is John McAdams.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-circle-address-1",
      SpeechResult: "12436. Saratoga Circle in Fort Worth.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /I am going to connect you with a funeral home team member now\./);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-circle-address-1/replay",
  );
  assert.equal(replay.body.session.currentState, "ESCALATE");
  assert.equal(replay.body.session.facts.caller_name, "Charles McDaniels");
  assert.equal(replay.body.session.facts.caller_phone, "432-569-4324");
  assert.equal(replay.body.session.facts.decedent_name, "John McAdams");
  assert.equal(replay.body.session.facts.pickup_address, "12436 Saratoga Circle Fort Worth");
  assert.deepEqual(replay.body.snapshot.completedToolNames, [
    "crm.create_intake_lead",
    "dispatch.create_removal_request",
  ]);
});

test("Twilio webhook route preserves caller name across phone-only turns and dotted decedent names", async () => {
  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-phone-only-followup-1",
      From: "+18179205700",
      To: "+15559870000",
      CallStatus: "in-progress",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-phone-only-followup-1",
      SpeechResult: "My name is Mario Lopez.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-phone-only-followup-1",
      SpeechResult: "I can be reached at. 769 432. 4218.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-phone-only-followup-1",
      SpeechResult: "Her name is Maria. Castro Rodriguez.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  const response = await fetchText(
    "POST",
    "/v1/tenants/fh-demo/telephony/twilio/webhook",
    new URLSearchParams({
      CallSid: "twilio-call-http-phone-only-followup-1",
      SpeechResult: "12724. Saratoga Springs. Circle in Fort Worth.",
      Confidence: "0.91",
    }),
    {
      apiKey: null,
      extraHeaders: {
        "content-type": "application/x-www-form-urlencoded",
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.body, /I am going to connect you with a funeral home team member now\./);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/twilio-call-http-phone-only-followup-1/replay",
  );
  assert.equal(replay.body.session.currentState, "ESCALATE");
  assert.equal(replay.body.session.facts.caller_name, "Mario Lopez");
  assert.equal(replay.body.session.facts.caller_phone, "769-432-4218");
  assert.equal(replay.body.session.facts.decedent_name, "Maria Castro Rodriguez");
  assert.equal(replay.body.session.facts.pickup_address, "12724 Saratoga Springs Circle Fort Worth");
  const callerIntentEvent = replay.body.events.find(
    (event: { eventType: string; payload: { factConfidence?: Record<string, number> } }) =>
      event.eventType === "INTENT_DETECTED" && event.payload.factConfidence?.caller_name,
  );
  assert.equal(callerIntentEvent.payload.factConfidence.caller_name, 0.86);
  assert.equal(callerIntentEvent.payload.factConfidence.caller_phone, undefined);
  const finalIntentEvent = replay.body.events
    .filter((event: { eventType: string }) => event.eventType === "INTENT_DETECTED")
    .at(-1);
  assert.equal(finalIntentEvent.payload.factConfidence.pickup_address, 0.82);
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
      interruptedOutput: "I am assisting the funeral director with gathering call information.",
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

test("first-call API uses short name answers to fill the active decedent-name slot", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-slot-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-1/transcript", {
    transcript: "My name is Kyle. My father drawn passed away at 12 3 Main Street. My phone is 603-731-5845.",
  });

  const turn = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-1/transcript", {
    transcript: "John.",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.decedent_name, "John");
  assert.notEqual(turn.body.decision.step, "collect_decedent");
});

test("first-call API accepts punctuated decedent name answers", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-decedent-punctuated-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-decedent-punctuated-1/transcript", {
    transcript: "My name is Kyle. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-decedent-punctuated-1/transcript",
    {
      transcript: "Amy. Lee.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.decedent_name, "Amy Lee");
  assert.equal(turn.body.decision.step, "collect_location");
});

test("first-call API accepts lowercase words in decedent name answers", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-decedent-lowercase-name",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-decedent-lowercase-name/transcript", {
    transcript: "My name is Kyle. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-decedent-lowercase-name/transcript",
    {
      transcript: "Applejack MC pinky butt.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.decedent_name, "Applejack MC Pinky Butt");
  assert.equal(turn.body.decision.step, "collect_location");
});

test("first-call API accepts name-is decedent answers", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-decedent-name-is-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-decedent-name-is-1/transcript", {
    transcript: "My name is Kyle. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-decedent-name-is-1/transcript",
    {
      transcript: "The name is Amy Lee.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.decedent_name, "Amy Lee");
  assert.equal(turn.body.decision.step, "collect_location");
});

test("first-call API preserves hospice facility context across address collection", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-hospice-facility-1",
    callerPhone: "603-731-5845",
  });

  const caller = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-hospice-facility-1/transcript",
    {
      transcript: "This is Nurse Sarah at Green Valley. Hospice, my phone here is 214. 639 5723.",
    },
  );

  assert.equal(caller.status, 200);
  assert.equal(caller.body.session.facts.caller_name, "Sarah");
  assert.equal(caller.body.session.facts.caller_phone, "214-639-5723");
  assert.equal(caller.body.session.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(caller.body.session.facts.facility_contact_role, "nurse");
  assert.equal(caller.body.session.facts.facility_name, "Green Valley Hospice");
  assert.equal(caller.body.session.facts.place_of_death_type, "hospice");
  assert.equal(caller.body.decision.step, "collect_decedent");

  const decedent = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-hospice-facility-1/transcript",
    {
      transcript: "I'm calling about Mr. Robert Jones in room 214.",
    },
  );

  assert.equal(decedent.status, 200);
  assert.equal(decedent.body.session.facts.decedent_name, "Robert Jones");
  assert.equal(decedent.body.decision.step, "collect_location");

  const location = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-hospice-facility-1/transcript",
    {
      transcript: "We are at Green Valley. Hospice at 1297 Green, Mountain, Drive in South Lake, Texas.",
    },
  );

  assert.equal(location.status, 200);
  assert.equal(location.body.session.facts.facility_name, "Green Valley Hospice");
  assert.equal(location.body.session.facts.place_of_death_type, "hospice");
  assert.equal(location.body.session.facts.pickup_address, "1297 Green Mountain Drive South Lake Texas");
  assert.equal(location.body.session.currentState, "ESCALATE");
  assert.equal(location.body.decision.step, "escalate");
});

test("first-call API preserves medical examiner context and case reference", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-medical-examiner-1",
    callerPhone: "603-731-5845",
  });

  const caller = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-medical-examiner-1/transcript",
    {
      transcript:
        "This is investigator, Sarah Miller with the Terra County Medical examiner's Office, my call back. Number is 214. 639 5723.",
    },
  );

  assert.equal(caller.status, 200);
  assert.equal(caller.body.session.facts.caller_name, "Sarah Miller");
  assert.equal(caller.body.session.facts.pickup_contact_name, "Sarah Miller");
  assert.equal(caller.body.session.facts.caller_phone, "214-639-5723");
  assert.equal(caller.body.session.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(caller.body.session.facts.facility_contact_role, "investigator");
  assert.equal(caller.body.session.facts.facility_name, "Terra County Medical Examiner's Office");
  assert.equal(caller.body.session.facts.place_of_death_type, "medical_examiner");
  assert.equal(caller.body.decision.step, "collect_decedent");

  const decedent = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-medical-examiner-1/transcript",
    {
      transcript: "Calling about Robert Jones case. Number 2611232,",
    },
  );

  assert.equal(decedent.status, 200);
  assert.equal(decedent.body.session.facts.decedent_name, "Robert Jones");
  assert.equal(decedent.body.session.facts.crm_existing_case_reference, "2611232");
  assert.equal(decedent.body.decision.step, "collect_location");

  const location = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-medical-examiner-1/transcript",
    {
      transcript: "He is at the medical examiner's office at 200 Medical Center Drive in Fort Worth Texas.",
    },
  );

  assert.equal(location.status, 200);
  assert.equal(location.body.session.facts.caller_name, "Sarah Miller");
  assert.equal(location.body.session.facts.decedent_name, "Robert Jones");
  assert.equal(location.body.session.facts.crm_existing_case_reference, "2611232");
  assert.equal(location.body.session.facts.facility_name, "Terra County Medical Examiner's Office");
  assert.equal(location.body.session.facts.place_of_death_type, "medical_examiner");
  assert.equal(location.body.session.facts.pickup_address, "200 Medical Center Drive Fort Worth Texas");
  assert.equal(location.body.handoff.decedent.existingCaseReference, "2611232");
  assert.equal(location.body.session.currentState, "ESCALATE");
  assert.equal(location.body.decision.step, "escalate");
});

test("first-call API captures hospital release decedent on the first turn", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-hospital-release-1",
    callerPhone: "603-731-5845",
  });

  const caller = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-hospital-release-1/transcript",
    {
      transcript:
        "Hi. This is David Carter from Sunrise Hospital. We have Helen Brooks ready for release my call. Back number is 214-639-5723.",
    },
  );

  assert.equal(caller.status, 200);
  assert.equal(caller.body.session.facts.caller_name, "David Carter");
  assert.equal(caller.body.session.facts.caller_phone, "214-639-5723");
  assert.equal(caller.body.session.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(caller.body.session.facts.decedent_name, "Helen Brooks");
  assert.equal(caller.body.session.facts.facility_name, "Sunrise Hospital");
  assert.equal(caller.body.session.facts.place_of_death_type, "hospital");
  assert.equal(caller.body.session.facts.urgency, "urgent");
  assert.equal(caller.body.decision.step, "collect_location");

  const location = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-hospital-release-1/transcript",
    {
      transcript: "She's at Sunrise Hospital at 500 Medical Center Drive in Fort Worth Texas.",
    },
  );

  assert.equal(location.status, 200);
  assert.equal(location.body.session.facts.decedent_name, "Helen Brooks");
  assert.equal(location.body.session.facts.caller_relationship_to_decedent, "facility_staff");
  assert.equal(location.body.session.facts.urgency, "urgent");
  assert.equal(location.body.session.facts.pickup_address, "500 Medical Center Drive Fort Worth Texas");
  assert.equal(location.body.handoff.priority, "urgent");
  assert.equal(location.body.session.currentState, "ESCALATE");
  assert.equal(location.body.decision.step, "escalate");
});

test("first-call API routes pricing inquiries to office-hours follow-up", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-pricing-inquiry-1",
    callerPhone: "603-731-5845",
  });

  const opening = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-pricing-inquiry-1/transcript",
    {
      transcript:
        "Hi, I'm calling to ask about cremation pricing. No one has passed away right now. I'm just trying to understand your basic direct cremation cost and what is included.",
    },
  );

  assert.equal(opening.status, 200);
  assert.equal(opening.body.session.intent, "pricing_or_billing");
  assert.equal(opening.body.session.facts.death_reported, false);
  assert.equal(opening.body.session.facts.reasonForCall, "pricing_or_billing");
  assert.equal(opening.body.session.facts.urgency, "routine");
  assert.equal(opening.body.session.facts.decedent_name, undefined);
  assert.equal(opening.body.decision.step, "collect_caller");
  assert.doesNotMatch(opening.body.responseText, /person who passed away|located right now/i);

  const contact = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-pricing-inquiry-1/transcript",
    {
      transcript: "My name is Kyle Smith. My callback number is 603-731-5845.",
    },
  );

  assert.equal(contact.status, 200);
  assert.equal(contact.body.session.currentState, "WRAPUP");
  assert.equal(contact.body.session.intent, "pricing_or_billing");
  assert.equal(contact.body.session.facts.caller_name, "Kyle Smith");
  assert.equal(contact.body.session.facts.caller_phone, "603-731-5845");
  assert.equal(contact.body.session.facts.death_reported, false);
  assert.equal(contact.body.session.facts.decedent_name, undefined);
  assert.equal(contact.body.decision.step, "routine_follow_up");
  assert.deepEqual(contact.body.toolResults.map((result: { toolName: string }) => result.toolName), [
    "crm.create_intake_lead",
  ]);
  assert.match(contact.body.responseText, /follow up during office hours/i);
});

test("first-call API passes current facts and active step into extractor", async () => {
  const seenContexts: Array<{
    activeStep?: string;
    currentFacts?: Record<string, unknown>;
    missingTargetFacts?: string[];
  }> = [];
  const extractor: FirstCallExtractor = {
    extract(transcript, context) {
      seenContexts.push({
        ...(context?.activeStep ? { activeStep: context.activeStep } : {}),
        ...(context?.currentFacts ? { currentFacts: context.currentFacts } : {}),
        ...(context?.missingTargetFacts ? { missingTargetFacts: context.missingTargetFacts } : {}),
      });
      if (/kyle/i.test(transcript)) {
        return {
          intent: "unknown",
          facts: {
            caller_name: "Kyle Finny",
            caller_phone: "817-463-5280",
          },
          sentiment: "unknown",
          confidence: 0.82,
          warnings: ["decedent_name_not_found", "pickup_context_not_found"],
        };
      }
      return {
        intent: "unknown",
        facts: context?.activeStep === "collect_decedent" ? { decedent_name: "Amy Lee" } : {},
        sentiment: "unknown",
        confidence: 0.82,
        warnings: [],
      };
    },
  };

  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions",
    {
      sessionId: "session-contextual-extractor-1",
      callerPhone: "817-463-5280",
    },
    { extractor },
  );
  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-extractor-1/transcript",
    {
      transcript: "My name is Kyle Finny. My number is 817-463-5280.",
    },
    { extractor },
  );

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-extractor-1/transcript",
    {
      transcript: "The name is Amy Lee.",
    },
    { extractor },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.decedent_name, "Amy Lee");
  assert.equal(seenContexts.at(-1)?.activeStep, "collect_decedent");
  assert.match(String(seenContexts.at(-1)?.currentFacts?.caller_name ?? ""), /^Kyle\b/);
  assert.equal(seenContexts.at(-1)?.currentFacts?.caller_phone, "817-463-5280");
  assert.deepEqual(seenContexts.at(-1)?.missingTargetFacts?.includes("decedent_name"), true);
});

test("first-call API preserves caller identity when decedent answer uses my-name phrasing", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-decedent-my-name-preserves-caller-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-decedent-my-name-preserves-caller-1/transcript",
    {
      transcript: "My name is Randall White. My phone number is 603-431-6382.",
    },
  );

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-decedent-my-name-preserves-caller-1/transcript",
    {
      transcript: "My name is George Watson.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.caller_name, "Randall White");
  assert.equal(turn.body.session.facts.pickup_contact_name, "Randall White");
  assert.equal(turn.body.session.facts.decedent_name, "George Watson");
  assert.equal(turn.body.decision.step, "collect_location");
});

test("first-call API blocks extractor caller-name overwrites outside caller collection", async () => {
  const extractor: FirstCallExtractor = {
    extract(transcript, context) {
      if (/randall/i.test(transcript)) {
        return {
          intent: "unknown",
          facts: {
            caller_name: "Randall White",
            pickup_contact_name: "Randall White",
            caller_phone: "603-431-6382",
          },
          factConfidence: {
            caller_name: 0.9,
            pickup_contact_name: 0.9,
            caller_phone: 0.92,
          },
          sentiment: "unknown",
          confidence: 0.9,
          warnings: [],
        };
      }
      return {
        intent: "unknown",
        facts: context?.activeStep === "collect_decedent"
          ? {
              caller_name: "George Watson",
              pickup_contact_name: "George Watson",
              decedent_name: "George Watson",
            }
          : {},
        factConfidence: {
          caller_name: 0.99,
          pickup_contact_name: 0.99,
          decedent_name: 0.9,
        },
        sentiment: "unknown",
        confidence: 0.9,
        warnings: [],
      };
    },
  };

  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions",
    {
      sessionId: "session-decedent-extractor-caller-overwrite-1",
      callerPhone: "603-731-5845",
    },
    { extractor },
  );
  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-decedent-extractor-caller-overwrite-1/transcript",
    {
      transcript: "My name is Randall White. My phone number is 603-431-6382.",
    },
    { extractor },
  );

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-decedent-extractor-caller-overwrite-1/transcript",
    {
      transcript: "My name is George Watson.",
    },
    { extractor },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.caller_name, "Randall White");
  assert.equal(turn.body.session.facts.pickup_contact_name, "Randall White");
  assert.equal(turn.body.session.facts.decedent_name, "George Watson");
  assert.equal(turn.body.decision.step, "collect_location");
});

test("first-call API does not treat repeated caller name as decedent while caller identity is incomplete", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-caller-repeat-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-repeat-1/transcript", {
    transcript: "My name is Kyle.",
  });

  const repeatedName = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-repeat-1/transcript",
    {
      transcript: "Kyle Finny.",
    },
  );

  assert.equal(repeatedName.status, 200);
  assert.match(String(repeatedName.body.session.facts.caller_name ?? ""), /^Kyle\b/);
  assert.equal(repeatedName.body.session.facts.decedent_name, undefined);
  assert.equal(repeatedName.body.decision.step, "collect_caller");
});

test("first-call API asks only for phone after caller gives name phrase", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-caller-name-only-1",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-name-only-1/transcript",
    {
      transcript: "My name is Kyle.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.caller_name, "Kyle");
  assert.equal(turn.body.decision.step, "collect_caller");
  assert.equal(turn.body.responseText, "What is the best phone number in case we are disconnected?");
});

test("first-call API asks for spelling when caller name has known suspicious STT spelling", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-caller-spelling-1",
  });

  const callerTurn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-spelling-1/transcript",
    {
      transcript: "My name is Kyle Finny, and my phone number is 603-731-5845.",
    },
  );

  assert.equal(callerTurn.status, 200);
  assert.equal(callerTurn.body.session.facts.caller_name, "Kyle Finny");
  assert.equal(callerTurn.body.session.facts.caller_name_spelling_status, "needs_confirmation");
  assert.equal(callerTurn.body.decision.step, "collect_caller");
  assert.equal(callerTurn.body.responseText, "I have the callback number. I heard your name as Kyle Finny. Please spell your last name for the funeral director.");

  const spellingTurn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-spelling-1/transcript",
    {
      transcript: "Last name is spelled f. I n n e y.",
    },
  );

  assert.equal(spellingTurn.status, 200);
  assert.equal(spellingTurn.body.session.facts.caller_name, "Kyle Finney");
  assert.equal(spellingTurn.body.session.facts.pickup_contact_name, "Kyle Finney");
  assert.equal(spellingTurn.body.session.facts.caller_name_spelling_status, "confirmed");
  assert.equal(spellingTurn.body.session.facts.caller_name_spelling_corrected, "Kyle Finney");
  assert.equal(spellingTurn.body.decision.step, "collect_decedent");
  assert.equal(spellingTurn.body.responseText, "May I have the name of the person who passed away?");
});

test("first-call API asks for spelling when Twilio separates suspicious surname with commas", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-caller-spelling-comma-1",
  });

  const callerTurn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-spelling-comma-1/transcript",
    {
      transcript: "My name is Kyle, feny, my phone number is 603-731-5845.",
    },
  );

  assert.equal(callerTurn.status, 200);
  assert.equal(callerTurn.body.session.facts.caller_name, "Kyle Feny");
  assert.equal(callerTurn.body.session.facts.caller_name_spelling_status, "needs_confirmation");
  assert.equal(callerTurn.body.decision.step, "collect_caller");
  assert.equal(callerTurn.body.responseText, "I have the callback number. I heard your name as Kyle Feny. Please spell your last name for the funeral director.");

  const spellingTurn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-spelling-comma-1/transcript",
    {
      transcript: "F I N N E Y.",
    },
  );

  assert.equal(spellingTurn.status, 200);
  assert.equal(spellingTurn.body.session.facts.caller_name, "Kyle Finney");
  assert.equal(spellingTurn.body.session.facts.pickup_contact_name, "Kyle Finney");
  assert.equal(spellingTurn.body.session.facts.caller_name_spelling_status, "confirmed");
  assert.equal(spellingTurn.body.decision.step, "collect_decedent");
});

test("first-call API does not ask ordinary caller names for spelling", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-caller-spelling-ordinary-1",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-spelling-ordinary-1/transcript",
    {
      transcript: "My name is Kyle Finney, and my phone number is 603-731-5845.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.caller_name, "Kyle Finney");
  assert.equal(turn.body.session.facts.caller_name_spelling_status, undefined);
  assert.equal(turn.body.decision.step, "collect_decedent");
  assert.equal(turn.body.responseText, "May I have the name of the person who passed away?");
});

test("first-call API asks only for phone after caller gives bare name", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-caller-name-only-2",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-name-only-2/transcript",
    {
      transcript: "Kyle.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.caller_name, "Kyle");
  assert.equal(turn.body.decision.step, "collect_caller");
  assert.equal(turn.body.responseText, "What is the best phone number in case we are disconnected?");
});

test("first-call API accepts lowercase words in caller name answers", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-caller-lowercase-name",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-caller-lowercase-name/transcript",
    {
      transcript: "Bob poodle.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.caller_name, "Bob Poodle");
  assert.equal(turn.body.decision.step, "collect_caller");
  assert.equal(turn.body.responseText, "What is the best phone number in case we are disconnected?");
});

test("first-call API uses address-only answers to fill the active pickup-address slot", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-slot-2",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-2/transcript", {
    transcript: "My name is Kyle. My father John passed away. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-2/transcript", {
    transcript: "123 Main Street.",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.death_reported, true);
  assert.equal(turn.body.session.facts.pickup_address, "123 Main Street");
  assert.equal(turn.body.session.currentState, "ESCALATE");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API captures decedent name from mixed decedent and garbled location answer", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-mixed-decedent-location-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-mixed-decedent-location-1/transcript", {
    transcript: "My name is Kyle Finney. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-mixed-decedent-location-1/transcript",
    {
      transcript: "Robert Jones, 636 Homer, Salve and Keller, Texas.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.decedent_name, "Robert Jones");
  assert.equal(turn.body.session.facts.pickup_address, undefined);
  assert.equal(turn.body.decision.step, "collect_location");
  assert.equal(turn.body.responseText, "Where is your loved one located right now?");
});

test("first-call API captures decedent name before an at-address cue", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-mixed-decedent-location-at-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-mixed-decedent-location-at-1/transcript", {
    transcript: "My name is Kyle Finney. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-mixed-decedent-location-at-1/transcript",
    {
      transcript: "Robert Jones at 636 Sr. To have and Keller, Texas.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.decedent_name, "Robert Jones");
  assert.equal(turn.body.session.facts.pickup_address, undefined);
  assert.equal(turn.body.decision.step, "collect_location");
  assert.equal(turn.body.responseText, "Where is your loved one located right now?");
});

test("first-call API repairs spoken Avenue heard as a in pickup-address slot", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-address-avenue-a-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-avenue-a-1/transcript", {
    transcript: "My name is Kyle Finney. My phone number is 603-731-5845.",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-avenue-a-1/transcript", {
    transcript: "Robert Jones.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-avenue-a-1/transcript",
    {
      transcript: "6326 Commerce a Keller Texas.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "6326 Commerce Ave Keller Texas");
  assert.equal(turn.body.session.currentState, "ESCALATE");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API repairs spoken Avenue heard as a from in pickup-address slot", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-address-avenue-a-from-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-avenue-a-from-1/transcript", {
    transcript: "My name is Kyle Finney. My phone number is 603-731-5845.",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-avenue-a-from-1/transcript", {
    transcript: "Robert Jones.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-avenue-a-from-1/transcript",
    {
      transcript: "At 6326 Commerce, a from Keller, Texas.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "6326 Commerce Ave Keller Texas");
  assert.equal(turn.body.session.currentState, "ESCALATE");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API removes and after street suffix in pickup-address slot", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-address-suffix-and-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-suffix-and-1/transcript", {
    transcript: "My name is Kyle Finney. My phone number is 603-731-5845.",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-suffix-and-1/transcript", {
    transcript: "Robert Jones.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-suffix-and-1/transcript",
    {
      transcript: "They're at 636 Commerce, Ave and Keller, Texas.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "636 Commerce Ave Keller Texas");
  assert.equal(turn.body.session.currentState, "ESCALATE");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API repairs spoken Avenue heard as salve in pickup-address slot", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-address-avenue-salve-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-avenue-salve-1/transcript", {
    transcript: "My name is Kyle Finney. My phone number is 603-731-5845.",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-avenue-salve-1/transcript", {
    transcript: "Robert Jones.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-avenue-salve-1/transcript",
    {
      transcript: "636 Commerce Salve and Keller, Texas.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "636 Commerce Ave Keller Texas");
  assert.equal(turn.body.session.currentState, "ESCALATE");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API repairs street number heard like a time in pickup-address slot", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-address-time-number-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-time-number-1/transcript", {
    transcript: "My name is Kyle Finney. My phone number is 603-731-5845.",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-time-number-1/transcript", {
    transcript: "Robert Jones.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-address-time-number-1/transcript",
    {
      transcript: "At 6:36 Commerce. Salve and Keller, Texas.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "636 Commerce Ave Keller Texas");
  assert.equal(turn.body.session.currentState, "ESCALATE");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API keeps death report fact true across contextual slot answers", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-slot-death-report",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-death-report/transcript", {
    transcript: "Bob Jones 621 563 2430.",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-death-report/transcript", {
    transcript: "Jimbo Jones.",
  });

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-death-report/transcript",
    {
      transcript: "129 Up the Creek Road Denton, Texas.",
    },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.death_reported, true);
  assert.equal(turn.body.session.facts.reasonForCall, "first_call_death_report");
  assert.equal(turn.body.session.facts.decedent_name, "Jimbo Jones");
  assert.equal(turn.body.session.facts.pickup_address, "129 Up the Creek Road Denton Texas");
  assert.equal(turn.body.session.currentState, "ESCALATE");
});

test("first-call API normalizes spaced digit address-only answers", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-slot-3",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-3/transcript", {
    transcript: "My name is Kyle. My father John passed away. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-3/transcript", {
    transcript: "1, 2 3 Main Street.",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "123 Main Street");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API accepts lowercase and prefixed address-only answers", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-slot-4",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-4/transcript", {
    transcript: "My name is Kyle. My father John passed away. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-4/transcript", {
    transcript: "My loved one is at 1 2 3, main Street.",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "123 main Street");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API preserves city from punctuated spoken address answers", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-slot-5",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-5/transcript", {
    transcript: "My name is Kyle. My father John passed away. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-5/transcript", {
    transcript: "1683. Maple Street Fort Worth.",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "1683 Maple Street Fort Worth");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API preserves city after street punctuation and in phrase", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-slot-6",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-6/transcript", {
    transcript: "My name is Kyle. My father John passed away. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-6/transcript", {
    transcript: "5817. Television Street. In Fort Worth.",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "5817 Television Street Fort Worth");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API lets higher-confidence extraction correct suspicious address city tokens", async () => {
  const extractor: FirstCallExtractor = {
    extract(transcript) {
      if (/Carl Smith/i.test(transcript)) {
        return {
          intent: "unknown",
          facts: {
            caller_name: "Carl Smith",
            caller_phone: "817-236-4312",
          },
          sentiment: "unknown",
          confidence: 0.82,
          factConfidence: {
            caller_name: 0.86,
            caller_phone: 0.92,
          },
          warnings: ["decedent_name_not_found", "pickup_context_not_found"],
        };
      }
      if (/Eleanor/i.test(transcript)) {
        return {
          intent: "unknown",
          facts: {
            decedent_name: "Eleanor Briggs",
          },
          sentiment: "unknown",
          confidence: 0.82,
          factConfidence: {
            decedent_name: 0.84,
          },
          warnings: ["pickup_context_not_found"],
        };
      }
      return {
        intent: "unknown",
        facts: {
          pickup_address: "1627 Commercial Avenue Seagoville Texas",
          place_of_death_type: "residence",
        },
        sentiment: "unknown",
        confidence: 0.9,
        factConfidence: {
          pickup_address: 0.9,
          place_of_death_type: 0.72,
        },
        warnings: [],
      };
    },
  };

  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions",
    {
      sessionId: "session-contextual-slot-validated-address-1",
      callerPhone: "603-731-5845",
    },
    { extractor },
  );
  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-validated-address-1/transcript",
    {
      transcript: "My name is Carl Smith. I can be reached at 817 236 4312.",
    },
    { extractor },
  );
  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-validated-address-1/transcript",
    {
      transcript: "The name is Eleanor Briggs.",
    },
    { extractor },
  );

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-validated-address-1/transcript",
    {
      transcript: "1627. Commercial Avenue. In cville, Texas.",
    },
    { extractor },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "1627 Commercial Avenue Seagoville Texas");
  assert.equal(turn.body.decision.step, "escalate");

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-validated-address-1/replay");
  const finalIntentEvent = replay.body.events
    .filter((event: { eventType: string }) => event.eventType === "INTENT_DETECTED")
    .at(-1);
  assert.equal(finalIntentEvent.payload.factConfidence.pickup_address, 0.9);
});

test("first-call API lets higher-confidence extraction correct suspicious street-name tokens", async () => {
  const extractor: FirstCallExtractor = {
    extract(transcript) {
      if (/Kyle/i.test(transcript)) {
        return {
          intent: "unknown",
          facts: {
            caller_name: "Kyle Finney",
            caller_phone: "603-731-5845",
          },
          sentiment: "unknown",
          confidence: 0.82,
          factConfidence: {
            caller_name: 0.86,
            caller_phone: 0.92,
          },
          warnings: ["decedent_name_not_found", "pickup_context_not_found"],
        };
      }
      if (/John Adams/i.test(transcript)) {
        return {
          intent: "unknown",
          facts: {
            decedent_name: "John Adams",
          },
          sentiment: "unknown",
          confidence: 0.82,
          factConfidence: {
            decedent_name: 0.84,
          },
          warnings: ["pickup_context_not_found"],
        };
      }
      return {
        intent: "unknown",
        facts: {
          pickup_address: "639 Jamestown Street Southlake Texas",
          place_of_death_type: "residence",
        },
        sentiment: "unknown",
        confidence: 0.9,
        factConfidence: {
          pickup_address: 0.9,
          place_of_death_type: 0.72,
        },
        warnings: [],
      };
    },
  };

  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions",
    {
      sessionId: "session-contextual-slot-validated-address-2",
      callerPhone: "603-731-5845",
    },
    { extractor },
  );
  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-validated-address-2/transcript",
    {
      transcript: "My name is Kyle Finney. My phone number is 603-731-5845.",
    },
    { extractor },
  );
  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-validated-address-2/transcript",
    {
      transcript: "John Adams.",
    },
    { extractor },
  );

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-validated-address-2/transcript",
    {
      transcript: "639. gymnastics Street. In South Lake, Texas.",
    },
    { extractor },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "639 Jamestown Street Southlake Texas");
  assert.equal(turn.body.decision.step, "escalate");

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-validated-address-2/replay");
  const finalIntentEvent = replay.body.events
    .filter((event: { eventType: string }) => event.eventType === "INTENT_DETECTED")
    .at(-1);
  assert.equal(finalIntentEvent.payload.factConfidence.pickup_address, 0.9);
});

test("first-call API asks caller to confirm suspicious street-name tokens", async () => {
  const extractor: FirstCallExtractor = {
    extract(transcript) {
      if (/Kyle/i.test(transcript)) {
        return {
          intent: "unknown",
          facts: {
            caller_name: "Kyle Finney",
            caller_phone: "603-731-5845",
          },
          sentiment: "unknown",
          confidence: 0.82,
          factConfidence: {
            caller_name: 0.86,
            caller_phone: 0.92,
          },
          warnings: ["decedent_name_not_found", "pickup_context_not_found"],
        };
      }
      if (/John Adams/i.test(transcript)) {
        return {
          intent: "unknown",
          facts: {
            decedent_name: "John Adams",
          },
          sentiment: "unknown",
          confidence: 0.82,
          factConfidence: {
            decedent_name: 0.84,
          },
          warnings: ["pickup_context_not_found"],
        };
      }
      return {
        intent: "unknown",
        facts: {
          pickup_address: "639 gymnastics Street, South Lake, Texas",
          place_of_death_type: "residence",
        },
        sentiment: "unknown",
        confidence: 0.82,
        factConfidence: {
          pickup_address: 0.82,
          place_of_death_type: 0.72,
        },
        warnings: [],
      };
    },
  };

  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions",
    {
      sessionId: "session-contextual-slot-confirm-address-1",
      callerPhone: "603-731-5845",
    },
    { extractor },
  );
  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-confirm-address-1/transcript",
    {
      transcript: "My name is Kyle Finney. My phone number is 603-731-5845.",
    },
    { extractor },
  );
  await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-confirm-address-1/transcript",
    {
      transcript: "John Adams.",
    },
    { extractor },
  );

  const turn = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-confirm-address-1/transcript",
    {
      transcript: "639. gymnastics Street. In South Lake, Texas.",
    },
    { extractor },
  );

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.currentState, "RESOLVE_REQUEST");
  assert.equal(turn.body.decision.step, "collect_location");
  assert.equal(turn.body.session.facts.pickup_address, "639 gymnastics Street, South Lake, Texas");
  assert.match(turn.body.responseText, /Please repeat just the street name/);
  assert.equal(turn.body.handoff, undefined);

  const replay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-confirm-address-1/replay",
  );
  assert.equal(replay.body.snapshot.completedToolNames.includes("dispatch.create_removal_request"), false);

  const confirmed = await fetchJson(
    "POST",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-confirm-address-1/transcript",
    {
      transcript: "Gymnastics Street.",
    },
    { extractor },
  );

  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.decision.step, "escalate");
  assert.equal(confirmed.body.handoffRouting.destinationType, "on_call_phone");

  const confirmedReplay = await fetchJson(
    "GET",
    "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-confirm-address-1/replay",
  );
  assert.equal(confirmedReplay.body.snapshot.completedToolNames.includes("dispatch.create_removal_request"), true);
});

test("first-call API preserves apartment details from spoken address answers", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-contextual-slot-7",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-7/transcript", {
    transcript: "My name is Kyle. My father John passed away. My phone number is 603-731-5845.",
  });

  const turn = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-contextual-slot-7/transcript", {
    transcript: "6426. Oak, Street Denton, Texas and its apartment 413.",
  });

  assert.equal(turn.status, 200);
  assert.equal(turn.body.session.facts.pickup_address, "6426 Oak Street Denton Texas apartment 413");
  assert.equal(turn.body.decision.step, "escalate");
});

test("first-call API does not re-run completed CRM intake on repeated follow-up turns", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-no-duplicate-tools-1",
    callerPhone: "603-731-5845",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-no-duplicate-tools-1/transcript", {
    transcript: "My name is Kyle. My father John passed away. My phone number is 603-731-5845.",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-no-duplicate-tools-1/transcript", {
    transcript: "123 Main Street.",
  });
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-no-duplicate-tools-1/transcript", {
    transcript: "123 Main Street.",
  });

  const replay = await fetchJson("GET", "/v1/tenants/fh-demo/first-call/sessions/session-no-duplicate-tools-1/replay");
  const crmExecutedEvents = replay.body.events.filter(
    (event: { eventType: string; payload: { toolName?: string } }) =>
      event.eventType === "TOOL_EXECUTED" && event.payload.toolName === "crm.create_intake_lead",
  );
  const crmSkippedEvents = replay.body.events.filter(
    (event: { eventType: string; payload: { toolName?: string; reason?: string } }) =>
      event.eventType === "TOOL_SKIPPED" &&
      event.payload.toolName === "crm.create_intake_lead" &&
      event.payload.reason === "already_completed",
  );

  assert.equal(crmExecutedEvents.length, 1);
  assert.equal(crmSkippedEvents.length >= 1, true);
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
  options: {
    apiKey?: string | null;
    requestId?: string;
    idempotencyKey?: string;
    idempotencyStore?: IdempotencyStore;
    extraHeaders?: Record<string, string>;
    logger?: Logger;
    rateLimiter?: RateLimiter;
    webhookSignatureVerifier?: WebhookSignatureVerifier;
    telnyxClient?: TelnyxCallControlClient;
    telnyxReadiness?: TelnyxReadiness;
    twilioReadiness?: TwilioReadiness;
    extractor?: FirstCallExtractor;
  } = {},
): Promise<{ status: number; body: any; requestId: string | null; headers: Record<string, string> }> {
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  const apiKey = options.apiKey === undefined ? "demo-api-key" : options.apiKey;
  if (apiKey) headers["x-api-key"] = apiKey;
  if (options.requestId) headers["x-request-id"] = options.requestId;
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  Object.assign(headers, options.extraHeaders);
  if (body) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (Object.keys(headers).length > 0) init.headers = headers;
  const serviceOptions = {
    store: sharedStore,
    eventStore: sharedEventStore,
    tenantConfigStore: sharedTenantConfigStore,
  };
  if (options.extractor) Object.assign(serviceOptions, { extractor: options.extractor });
  const service = createFirstCallService(serviceOptions);
  const response = await handleApiRequest(
    service,
    new Request(`http://localhost${path}`, init),
    apiKeyVerifier,
    undefined,
    sharedTenantConfigStore,
    options.logger,
    options.rateLimiter,
    {
      serviceName: "voice-ai-platform",
      version: "test-version",
      commit: "test-commit",
      buildTime: "2026-06-06T12:00:00.000Z",
    },
    options.idempotencyStore,
    options.webhookSignatureVerifier,
    options.telnyxClient,
    options.telnyxReadiness,
    options.twilioReadiness,
  );
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  return {
    status: response.status,
    body: await response.json(),
    requestId: response.headers.get("x-request-id"),
    headers: responseHeaders,
  };
}

async function fetchText(
  method: string,
  path: string,
  body?: URLSearchParams,
  options: {
    apiKey?: string | null;
    requestId?: string;
    extraHeaders?: Record<string, string>;
    logger?: Logger;
    rateLimiter?: RateLimiter;
    webhookSignatureVerifier?: WebhookSignatureVerifier;
    telnyxClient?: TelnyxCallControlClient;
    telnyxReadiness?: TelnyxReadiness;
    twilioReadiness?: TwilioReadiness;
  } = {},
): Promise<{ status: number; body: string; requestId: string | null; headers: Record<string, string> }> {
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  const apiKey = options.apiKey === undefined ? "demo-api-key" : options.apiKey;
  if (apiKey) headers["x-api-key"] = apiKey;
  if (options.requestId) headers["x-request-id"] = options.requestId;
  Object.assign(headers, options.extraHeaders);
  if (body) init.body = body;
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
    options.logger,
    options.rateLimiter,
    {
      serviceName: "voice-ai-platform",
      version: "test-version",
      commit: "test-commit",
      buildTime: "2026-06-06T12:00:00.000Z",
    },
    undefined,
    options.webhookSignatureVerifier,
    options.telnyxClient,
    options.telnyxReadiness,
    options.twilioReadiness,
  );
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  return {
    status: response.status,
    body: await response.text(),
    requestId: response.headers.get("x-request-id"),
    headers: responseHeaders,
  };
}

class TestLogger implements Logger {
  readonly requests: ApiRequestLog[] = [];

  event(): void {}

  request(entry: ApiRequestLog): void {
    this.requests.push(entry);
  }

  lifecycle(): void {}

  error(): void {}
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
