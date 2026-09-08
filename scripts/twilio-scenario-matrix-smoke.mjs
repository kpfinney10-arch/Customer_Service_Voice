import crypto from "node:crypto";
import { WebSocket } from "ws";

const baseUrl = env("API_BASE_URL", "http://127.0.0.1:3000").replace(/\/+$/, "");
const relayPublicBaseUrl = env(
  "TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL",
  baseUrl.replace(/^http/, "ws"),
).replace(/\/+$/, "");
const relayConnectBaseUrl = env(
  "TWILIO_CONVERSATION_RELAY_CONNECT_BASE_URL",
  relayPublicBaseUrl,
).replace(/\/+$/, "");
const tenantId = env("TENANT_ID", "fh-demo");
const apiKey = env("TENANT_API_KEY", "replace-with-local-dev-key");
const authToken = env("TWILIO_AUTH_TOKEN", "");
const signedExpected = env("TWILIO_EXPECT_SIGNED_WEBHOOK", "false").toLowerCase() === "true";
const handoffModeExpected = env("TWILIO_EXPECT_HANDOFF_MODE", "live").toLowerCase();
const runId = env("TWILIO_SCENARIO_RUN_ID", `twilio-scenario-${Date.now()}`);
const fromNumber = env("TWILIO_SCENARIO_FROM", "+12025550100");
const toNumber = env("TWILIO_SCENARIO_TO", "+12025550101");
const scenarioConcurrency = parsePositiveInteger(
  env("TWILIO_SCENARIO_CONCURRENCY", "1"),
  "TWILIO_SCENARIO_CONCURRENCY",
);
const maxResponseMs = parsePositiveInteger(
  env("TWILIO_SCENARIO_MAX_RESPONSE_MS", "5000"),
  "TWILIO_SCENARIO_MAX_RESPONSE_MS",
);
const twilioResponseDurationsMs = [];
const relayResponseDurationsMs = [];

const scenarios = [
  {
    id: "hospice-noisy-named",
    title: "Hospice nurse residence death report with named funeral home",
    turns: [
      {
        speech:
          "Hi, this is Nurse. Emily. Johnson with Gentle Care. Hospice. I'm at the family's home with a Mr. Robert Jones. He has passed away in the family's. Requested Smith. Family Funeral Home my call back. Number is 202-555-0101. The address here is 636 Commerce Avenue. Keller Texas.",
        includes: ["<Dial "],
        excludes: ["May I have the name of the person who passed away", "Where is your loved one located right now"],
      },
    ],
    expectedState: "ESCALATE",
    expectedFacts: {
      caller_name: "Emily Johnson",
      caller_phone: "202-555-0101",
      facility_contact_role: "nurse",
      facility_name: "Gentle Care Hospice",
      decedent_name: "Robert Jones",
      pickup_address: "636 Commerce Avenue Keller Texas",
      currently_with_decedent: true,
      requested_funeral_home: "Smith Family Funeral Home",
    },
    expectedCompletedToolNames: ["crm.create_intake_lead", "dispatch.create_removal_request"],
  },
  {
    id: "me-missing-case",
    title: "Medical examiner release missing case number until prompted",
    turns: [
      {
        speech: "Hi. This is investigator. Sarah Miller with the Tarrant County Medical examiner's Office.",
        includes: ["What is the best phone number"],
      },
      {
        speech: "I'm at 202-555-0102.",
        includes: ["May I have the name of the person who passed away"],
      },
      {
        speech: "I have a Mr. Robert Jones. He is ready for release to Smith Family Funeral Home.",
        includes: ["medical examiner case number"],
        excludes: ["<Dial "],
      },
      {
        speech: "2611232.",
        includes: ["Where is your loved one located right now"],
      },
      {
        speech: "He can be picked up at 200 Felix. Groves place in Fort Worth Texas.",
        includes: ["<Dial "],
      },
    ],
    expectedState: "ESCALATE",
    expectedFacts: {
      caller_name: "Sarah Miller",
      caller_phone: "202-555-0102",
      facility_contact_role: "investigator",
      facility_name: "Tarrant County Medical Examiner's Office",
      decedent_name: "Robert Jones",
      crm_existing_case_reference: "2611232",
      pickup_address: "200 Feliks Gwozdz Place Fort Worth Texas",
      place_of_death_type: "medical_examiner",
      urgency: "emergency",
      currently_with_decedent: true,
      requested_funeral_home: "Smith Family Funeral Home",
    },
    expectedMissingFacts: [],
    expectedCompletedToolNames: ["crm.create_intake_lead", "dispatch.create_removal_request"],
  },
  {
    id: "hospital-dotted-release",
    title: "Hospital release with dotted STT punctuation",
    turns: [
      {
        speech:
          "Hi. This is David Carter from Sunrise Hospital. We have Helen. Brooks ready for release. The family has requested. Your funeral home. Pick up. Address is 500. Medical Center. Drive in Fort Worth Texas. My call back is 202 5550103.",
        includes: ["<Dial "],
        excludes: ["May I have the name of the person who passed away", "Where is your loved one located right now"],
      },
    ],
    expectedState: "ESCALATE",
    expectedFacts: {
      caller_name: "David Carter",
      caller_phone: "202-555-0103",
      caller_relationship_to_decedent: "facility_staff",
      facility_name: "Sunrise Hospital",
      decedent_name: "Helen Brooks",
      pickup_address: "500 Medical Center Drive Fort Worth Texas",
      place_of_death_type: "hospital",
      requested_funeral_home: "Your Funeral Home",
      urgency: "urgent",
    },
    expectedCompletedToolNames: ["crm.create_intake_lead", "dispatch.create_removal_request"],
  },
  {
    id: "police-residence",
    title: "Police officer residence death report across slot prompts",
    turns: [
      {
        speech: "My name is Officer Mendes with the Fort Worth Police Department needing to report a death.",
        includes: ["best phone number"],
      },
      {
        speech: "Officer Mendes at 202-555-0104.",
        includes: ["May I have the name of the person who passed away"],
      },
      {
        speech: "Her name is Elizabeth, Carter.",
        includes: ["Where is your loved one located right now"],
      },
      {
        speech: "She's at 5213 Hidden Oaks Lane in Fort Worth Texas.",
        includes: ["<Dial "],
      },
    ],
    expectedState: "ESCALATE",
    expectedFacts: {
      caller_name: "Officer Mendes",
      caller_phone: "202-555-0104",
      caller_relationship_to_decedent: "facility_staff",
      facility_contact_role: "officer",
      facility_name: "Fort Worth Police Department",
      decedent_name: "Elizabeth Carter",
      pickup_address: "5213 Hidden Oaks Lane Fort Worth Texas",
      place_of_death_type: "residence",
    },
    expectedCompletedToolNames: ["crm.create_intake_lead", "dispatch.create_removal_request"],
    expectedRecommendedActionsExclude: ["Verify the death with hospice, law enforcement, or the medical examiner"],
  },
  {
    id: "family-residence-authority-check",
    title: "Family residence death report escalates without dispatch request",
    turns: [
      {
        speech: "My name is Morgan Parker and my phone number is 202-555-0105.",
        includes: ["May I have the name of the person who passed away"],
      },
      {
        speech:
          "My father Robert Jones passed away at home and we want Smith Family Funeral Home to help us.",
        includes: ["Where is your loved one located right now"],
      },
      {
        speech: "He's at 636 Commerce Avenue Keller Texas.",
        includes: ["<Dial "],
      },
    ],
    expectedState: "ESCALATE",
    expectedFacts: {
      caller_name: "Morgan Parker",
      caller_phone: "202-555-0105",
      caller_relationship_to_decedent: "father",
      decedent_name: "Robert Jones",
      pickup_address: "636 Commerce Avenue Keller Texas",
      place_of_death_type: "residence",
      requested_funeral_home: "Smith Family Funeral Home",
    },
    expectedCompletedToolNames: ["crm.create_intake_lead"],
    expectedCompletedToolNamesExclude: ["dispatch.create_removal_request"],
    expectedRecommendedActionsInclude: ["Verify the death with hospice, law enforcement, or the medical examiner"],
  },
  {
    id: "pricing-routine",
    title: "Pricing inquiry fails closed without contact collection",
    turns: [
      {
        speech:
          "I'm calling to get direct. Cremation pricing. No 1 has passed away, but I'm just trying to better understand your price and structure for Cremations.",
        includes: [
          "I cannot provide pricing",
          "This demo does not have a staff transfer line configured",
          "do not need to leave your name or phone number",
          "<Hangup/>",
        ],
        excludes: ["May I have your name", "best phone number", "<Gather ", "<Dial"],
      },
    ],
    expectedState: "WRAPUP",
    expectedIntent: "pricing_or_billing",
    expectedFacts: {
      reasonForCall: "pricing_or_billing",
      death_reported: false,
    },
    expectedFactAbsent: ["caller_name", "caller_phone", "decedent_name", "pickup_address"],
    expectedCompletedToolNames: [],
    expectedCompletedToolNamesExclude: ["crm.create_intake_lead", "dispatch.create_removal_request"],
  },
  {
    id: "family-office-hours",
    title: "Existing-family office-hours question closes without death intake",
    turns: [
      {
        speech:
          "Uh, hi. My name's Morgan Parker. I'm calling about my father. Robert Parker. The funeral home is already helping our family. This is not a new death call, not an emergency. Just want to know what time the office opens up tomorrow, whether I can drop off clothing for him in the morning, my call back number is 202-555-0106.",
        includes: ["follow up during office hours", "<Hangup/>"],
        excludes: ["person who passed away", "located right now", "<Dial"],
      },
    ],
    expectedState: "WRAPUP",
    expectedIntent: "service_schedule_question",
    expectedFacts: {
      caller_name: "Morgan Parker",
      caller_phone: "202-555-0106",
      decedent_name: "Robert Parker",
      reasonForCall: "service_schedule_question",
      death_reported: false,
      urgency: "routine",
    },
    expectedFactAbsent: ["requested_funeral_home"],
    expectedCompletedToolNames: ["crm.create_intake_lead"],
    expectedCompletedToolNamesExclude: ["dispatch.create_removal_request"],
  },
];

await main();

async function main() {
  console.log(`Twilio scenario matrix smoke against ${baseUrl}`);
  console.log(`Run id: ${runId}`);
  console.log(`Maximum concurrent scenarios: ${scenarioConcurrency}`);
  if (signedExpected && !authToken) {
    throw new Error("TWILIO_EXPECT_SIGNED_WEBHOOK=true requires TWILIO_AUTH_TOKEN.");
  }
  if (!["live", "simulate"].includes(handoffModeExpected)) {
    throw new Error("TWILIO_EXPECT_HANDOFF_MODE must be either live or simulate.");
  }
  if (scenarioConcurrency > scenarios.length) {
    throw new Error(`TWILIO_SCENARIO_CONCURRENCY cannot exceed ${scenarios.length}.`);
  }

  const readiness = await expectTenantJson("GET", `/v1/tenants/${tenantId}/telephony/twilio/readiness`, undefined, 200);
  assertEqual(readiness.twilioReadiness?.readyForLocalTesting, true, "Twilio local readiness");
  assertEqual(readiness.twilioReadiness?.handoffMode, handoffModeExpected, "Twilio handoff mode");
  if (signedExpected) {
    assertEqual(readiness.twilioReadiness?.readyForPublicTraffic, true, "Twilio public readiness");
  }

  for (let index = 0; index < scenarios.length; index += scenarioConcurrency) {
    const batch = scenarios.slice(index, index + scenarioConcurrency);
    const relayConnectionBarrier = createBarrier(batch.length);
    await Promise.all(batch.map((scenario) => runScenario(scenario, relayConnectionBarrier)));
  }

  const maximumObservedResponseMs = Math.max(...twilioResponseDurationsMs, ...relayResponseDurationsMs);
  if (maximumObservedResponseMs > maxResponseMs) {
    throw new Error(
      `Maximum Twilio or ConversationRelay response ${maximumObservedResponseMs}ms exceeded ${maxResponseMs}ms.`,
    );
  }

  console.log(`Maximum Twilio or ConversationRelay response: ${maximumObservedResponseMs}ms`);
  console.log(`Twilio scenario matrix smoke passed: ${scenarios.length}/${scenarios.length} scenarios.`);
}

async function runScenario(scenario, relayConnectionBarrier) {
  const callSid = `${runId}-${scenario.id}`;
  const initial = await postTwilioForm("/webhook", {
    CallSid: callSid,
    From: fromNumber,
    To: toNumber,
    CallStatus: "ringing",
  });
  if (initial.includes("<ConversationRelay")) {
    await runConversationRelayScenario(scenario, callSid, relayConnectionBarrier);
  } else {
    await runGatherScenario(scenario, callSid, initial);
  }

  await assertScenarioReplay(scenario, callSid);

  console.log(`PASS ${scenario.title}`);
  console.log(`  Call SID: ${callSid}`);
}

async function runGatherScenario(scenario, callSid, initial) {
  assertIncludes(initial, "<Gather ", `${scenario.id} initial gather`);

  for (const [index, turn] of scenario.turns.entries()) {
    const twiml = await postTwilioForm("/webhook", {
      CallSid: callSid,
      From: fromNumber,
      To: toNumber,
      CallStatus: "in-progress",
      SpeechResult: turn.speech,
      Confidence: turn.confidence ?? "0.92",
    });
    for (const expected of turn.includes ?? []) {
      if (expected === "<Dial " && handoffModeExpected === "simulate") {
        assertIncludes(
          twiml,
          "This demo has recorded that a funeral home team member should follow up.",
          `${scenario.id} turn ${index + 1} simulated handoff`,
        );
        assertIncludes(twiml, "<Hangup/>", `${scenario.id} turn ${index + 1} simulated hangup`);
        assertExcludes(twiml, "<Dial", `${scenario.id} turn ${index + 1} simulated dial`);
      } else {
        assertIncludes(twiml, expected, `${scenario.id} turn ${index + 1}`);
      }
    }
    for (const unexpected of turn.excludes ?? []) {
      assertExcludes(twiml, unexpected, `${scenario.id} turn ${index + 1}`);
    }
  }
}

async function runConversationRelayScenario(scenario, callSid, relayConnectionBarrier) {
  if (!authToken) {
    throw new Error("ConversationRelay scenario smoke requires TWILIO_AUTH_TOKEN.");
  }
  if (handoffModeExpected !== "simulate") {
    throw new Error("ConversationRelay scenario smoke requires simulated handoffs.");
  }

  const relayPath = `/v1/tenants/${tenantId}/telephony/twilio/conversation-relay`;
  const relayUrl = `${relayPublicBaseUrl}${relayPath}`;
  const relayConnectUrl = `${relayConnectBaseUrl}${relayPath}`;
  const webSocket = new WebSocket(relayConnectUrl, {
    headers: {
      "x-twilio-signature": createTwilioSignature({
        authToken,
        url: relayUrl,
        rawBody: "",
      }),
    },
  });

  try {
    await onceOpen(webSocket);
    webSocket.send(JSON.stringify({
      type: "setup",
      callSid,
      customParameters: { tenantId },
    }));
    await relayConnectionBarrier();

    let terminal;
    for (const [index, turn] of scenario.turns.entries()) {
      const responsePromise = onceMessage(webSocket);
      const requestStartedAt = Date.now();
      webSocket.send(JSON.stringify({
        type: "prompt",
        voicePrompt: turn.speech,
        lang: "en-US",
        last: true,
      }));
      const message = JSON.parse(await responsePromise);
      relayResponseDurationsMs.push(Date.now() - requestStartedAt);
      const isFinalTurn = index === scenario.turns.length - 1;
      assertEqual(message.type, isFinalTurn ? "end" : "text", `${scenario.id} relay message type`);
      if (isFinalTurn) terminal = message;
    }

    const reasonCode = JSON.parse(terminal.handoffData).reasonCode;
    const expectedReasonCode = scenario.expectedState === "ESCALATE"
      ? "handoff"
      : scenario.expectedIntent === "pricing_or_billing"
        ? "pricing_blocked"
        : "completed";
    assertEqual(reasonCode, expectedReasonCode, `${scenario.id} relay terminal reason`);

    const completionTwiml = await postTwilioForm("/conversation-relay/complete", {
      CallSid: callSid,
      HandoffData: terminal.handoffData,
    });
    assertIncludes(completionTwiml, "<Hangup/>", `${scenario.id} simulated relay hangup`);
    assertExcludes(completionTwiml, "<Dial", `${scenario.id} simulated relay dial`);
  } finally {
    await closeWebSocket(webSocket);
  }
}

async function assertScenarioReplay(scenario, callSid) {
  const replay = await expectTenantJson(
    "GET",
    `/v1/tenants/${tenantId}/first-call/sessions/${encodeURIComponent(callSid)}/replay`,
    undefined,
    200,
  );
  const facts = replay.session?.facts ?? {};
  const completedToolNames = replay.snapshot?.completedToolNames ?? [];
  const recommendedActions = replay.snapshot?.handoff?.recommendedActions ?? [];
  const missingFacts = replay.snapshot?.handoff?.missingFacts ?? [];

  assertEqual(replay.session?.currentState, scenario.expectedState, `${scenario.id} state`);
  if (scenario.expectedIntent) {
    assertEqual(replay.session?.intent, scenario.expectedIntent, `${scenario.id} intent`);
  }
  for (const [factName, expected] of Object.entries(scenario.expectedFacts ?? {})) {
    assertEqual(facts[factName], expected, `${scenario.id} fact ${factName}`);
  }
  for (const factName of scenario.expectedFactAbsent ?? []) {
    if (Object.hasOwn(facts, factName)) {
      throw new Error(`${scenario.id} expected fact ${factName} to be absent, got ${JSON.stringify(facts[factName])}`);
    }
  }
  if (scenario.expectedMissingFacts) {
    assertArrayEqual(missingFacts, scenario.expectedMissingFacts, `${scenario.id} missing facts`);
  }
  if (scenario.expectedCompletedToolNames) {
    assertArrayEqual(completedToolNames, scenario.expectedCompletedToolNames, `${scenario.id} completed tools`);
  }
  for (const toolName of scenario.expectedCompletedToolNamesExclude ?? []) {
    assertNotInArray(completedToolNames, toolName, `${scenario.id} excluded completed tool`);
  }
  for (const expected of scenario.expectedRecommendedActionsInclude ?? []) {
    assertIncludes(recommendedActions.join(" "), expected, `${scenario.id} recommended action`);
  }
  for (const unexpected of scenario.expectedRecommendedActionsExclude ?? []) {
    assertExcludes(recommendedActions.join(" "), unexpected, `${scenario.id} recommended action`);
  }
}

async function postTwilioForm(pathSuffix, fields) {
  const path = `/v1/tenants/${tenantId}/telephony/twilio${pathSuffix}`;
  const body = new URLSearchParams(fields);
  const rawBody = body.toString();
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (authToken) {
    headers["x-twilio-signature"] = createTwilioSignature({
      authToken,
      url: `${baseUrl}${path}`,
      rawBody,
    });
  }
  const requestStartedAt = Date.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body,
  });
  twilioResponseDurationsMs.push(Date.now() - requestStartedAt);
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`POST ${path} expected 200, got ${response.status}: ${text}`);
  }
  return text;
}

async function expectTenantJson(method, path, body, statusCode, headers = {}) {
  return expectJson(method, path, body, statusCode, {
    "x-api-key": apiKey,
    ...headers,
  });
}

async function expectJson(method, path, body, statusCode, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const responseBody = await response.json();
  if (response.status !== statusCode) {
    throw new Error(`${method} ${path} expected ${statusCode}, got ${response.status}: ${JSON.stringify(responseBody)}`);
  }
  return responseBody;
}

function createTwilioSignature(input) {
  const signedPayload = `${input.url}${twilioSortedFormPayload(input.rawBody)}`;
  return crypto.createHmac("sha1", input.authToken).update(signedPayload).digest("base64");
}

function twilioSortedFormPayload(rawBody) {
  const params = new URLSearchParams(rawBody);
  return Array.from(params.keys())
    .sort()
    .map((key) => `${key}${params.getAll(key).join("")}`)
    .join("");
}

function onceOpen(webSocket) {
  return withTimeout(new Promise((resolve, reject) => {
    webSocket.once("open", resolve);
    webSocket.once("error", reject);
    webSocket.once("unexpected-response", (_request, response) => {
      reject(new Error(`WebSocket upgrade failed with HTTP ${response.statusCode}.`));
    });
  }), "ConversationRelay WebSocket open");
}

function onceMessage(webSocket) {
  return withTimeout(new Promise((resolve, reject) => {
    webSocket.once("message", (data) => resolve(data.toString()));
    webSocket.once("error", reject);
    webSocket.once("close", (code, reason) => {
      reject(new Error(`WebSocket closed before a response (${code}: ${reason.toString()}).`));
    });
  }), "ConversationRelay message");
}

async function closeWebSocket(webSocket) {
  if (webSocket.readyState === WebSocket.CLOSED) return;
  if (webSocket.readyState === WebSocket.CONNECTING) {
    webSocket.terminate();
    return;
  }
  await withTimeout(new Promise((resolve) => {
    webSocket.once("close", resolve);
    webSocket.close();
  }), "ConversationRelay close");
}

function createBarrier(size) {
  let arrived = 0;
  let release;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived === size) release();
    await withTimeout(released, "ConversationRelay concurrency barrier");
  };
}

function withTimeout(promise, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${maxResponseMs}ms.`)), maxResponseMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertArrayEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(actual, expected, label) {
  if (!actual.includes(expected)) {
    throw new Error(`${label} expected ${JSON.stringify(expected)} in ${JSON.stringify(actual)}`);
  }
}

function assertExcludes(actual, unexpected, label) {
  if (actual.includes(unexpected)) {
    throw new Error(`${label} did not expect ${JSON.stringify(unexpected)} in ${JSON.stringify(actual)}`);
  }
}

function assertNotInArray(actual, unexpected, label) {
  if (actual.includes(unexpected)) {
    throw new Error(`${label} did not expect ${JSON.stringify(unexpected)} in ${JSON.stringify(actual)}`);
  }
}

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

function parsePositiveInteger(rawValue, name) {
  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}
