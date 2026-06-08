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
  createWebhookSignature,
  HmacWebhookSignatureVerifier,
} from "../src/security/webhook-signature.js";
import type { WebhookSignatureVerifier } from "../src/security/webhook-signature.js";
import { InMemorySessionStore } from "../src/session/in-memory-session-store.js";
import { InMemoryTenantConfigStore } from "../src/tenants/tenant-config.js";
import type { TelnyxCallControlClient } from "../src/providers/telephony/telnyx-client.js";
import type { TelnyxReadiness } from "../src/providers/telephony/telnyx-readiness.js";

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

test("Telnyx webhook route starts first-call session and returns command plan", async () => {
  const response = await fetchJson("POST", "/v1/tenants/fh-demo/telephony/telnyx/webhook", {
    data: {
      id: "telnyx-event-1",
      event_type: "call.initiated",
      payload: {
        call_control_id: "telnyx-call-http-1",
        from: "+15551230000",
        to: "+15559870000",
      },
    },
  });

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
            content: "I am sorry. I will help get this to the right person.",
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
    options.idempotencyStore,
    options.webhookSignatureVerifier,
    options.telnyxClient,
    options.telnyxReadiness,
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
