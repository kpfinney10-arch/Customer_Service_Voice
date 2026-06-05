import assert from "node:assert/strict";
import { test } from "node:test";
import { createFirstCallService } from "../src/api/first-call-service.js";
import { handleApiRequest } from "../src/api/http-server.js";
import { InMemorySessionStore } from "../src/session/in-memory-session-store.js";

test("health endpoint reports ready", async () => {
  const response = await fetchJson("GET", "/health");

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
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
  assert.deepEqual(turn.body.decision.toolNames, [
    "crm.create_intake_lead",
    "dispatch.create_removal_request",
  ]);
  assert.equal(turn.body.toolResults.length, 2);
  assert.equal(turn.body.events.length, 4);
});

test("first-call transcript endpoint validates required transcript", async () => {
  await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions", {
    sessionId: "session-api-2",
  });

  const response = await fetchJson("POST", "/v1/tenants/fh-demo/first-call/sessions/session-api-2/transcript", {});

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "VALIDATION_ERROR");
});

async function fetchJson(method: string, path: string, body?: object): Promise<{ status: number; body: any }> {
  const init: RequestInit = { method };
  if (body) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const service = createFirstCallService({ store: sharedStore });
  const response = await handleApiRequest(service, new Request(`http://localhost${path}`, init));
  return {
    status: response.status,
    body: await response.json(),
  };
}

const sharedStore = new InMemorySessionStore();
