import crypto from "node:crypto";

const baseUrl = env("API_BASE_URL", "http://127.0.0.1:3000").replace(/\/+$/, "");
const tenantId = env("TENANT_ID", "fh-demo");
const apiKey = env("TENANT_API_KEY", "replace-with-local-dev-key");
const authToken = env("TWILIO_AUTH_TOKEN", "");
const signedExpected = env("TWILIO_EXPECT_SIGNED_WEBHOOK", "false").toLowerCase() === "true";
const runId = env("TWILIO_SCENARIO_RUN_ID", `twilio-scenario-${Date.now()}`);
const fromNumber = env("TWILIO_SCENARIO_FROM", "+16037315845");
const toNumber = env("TWILIO_SCENARIO_TO", "+15559870000");

const scenarios = [
  {
    id: "hospice-noisy-named",
    title: "Hospice nurse residence death report with named funeral home",
    turns: [
      {
        speech:
          "Hi, this is Nurse. Emily. Johnson with Gentle Care. Hospice. I'm at the family's home with a Mr. Robert Jones. He has passed away in the family's. Requested Smith. Family Funeral Home my call back. Number is 214-639-5723. The address here is 636 Commerce Avenue. Keller Texas.",
        includes: ["<Dial "],
        excludes: ["May I have the name of the person who passed away", "Where is your loved one located right now"],
      },
    ],
    expectedState: "ESCALATE",
    expectedFacts: {
      caller_name: "Emily Johnson",
      caller_phone: "214-639-5723",
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
        speech: "I'm at 214-639-5723.",
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
      caller_phone: "214-639-5723",
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
          "Hi. This is David Carter from Sunrise Hospital. We have Helen. Brooks ready for release. The family has requested. Your funeral home. Pick up. Address is 500. Medical Center. Drive in Fort Worth Texas. My call back is 214 6395723.",
        includes: ["<Dial "],
        excludes: ["May I have the name of the person who passed away", "Where is your loved one located right now"],
      },
    ],
    expectedState: "ESCALATE",
    expectedFacts: {
      caller_name: "David Carter",
      caller_phone: "214-639-5723",
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
        speech: "Officer Mendes at 817-632-4211.",
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
      caller_phone: "817-632-4211",
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
        speech: "My name is Kyle Finney and my phone number is 603-731-5845.",
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
      caller_name: "Kyle Finney",
      caller_phone: "603-731-5845",
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
    title: "Routine pricing inquiry closes for office-hours follow-up",
    turns: [
      {
        speech:
          "Hi, I'm calling to ask about cremation pricing. No one has passed away right now. I'm just trying to understand your basic direct cremation cost and what is included.",
        includes: ["May I have your name"],
        excludes: ["person who passed away", "<Dial "],
      },
      {
        speech: "My name is Kyle Smith. My callback number is 603-731-5845.",
        includes: ["follow up during office hours", "<Hangup/>"],
        excludes: ["<Gather ", "<Dial"],
      },
    ],
    expectedState: "WRAPUP",
    expectedIntent: "pricing_or_billing",
    expectedFacts: {
      caller_name: "Kyle Smith",
      caller_phone: "603-731-5845",
      reasonForCall: "pricing_or_billing",
      death_reported: false,
    },
    expectedFactAbsent: ["decedent_name", "pickup_address"],
    expectedCompletedToolNames: ["crm.create_intake_lead"],
    expectedCompletedToolNamesExclude: ["dispatch.create_removal_request"],
  },
  {
    id: "family-office-hours",
    title: "Existing-family office-hours question closes without death intake",
    turns: [
      {
        speech:
          "Uh, hi. My name's Kyle finny. I'm calling about my father. Robert, finny funeral home is already helping our family. This is not a new death call, not an emergency. Just want to know what time the office opens up tomorrow, whether I can drop off clothing for him in the morning, my call back number is 603-731-5845.",
        includes: ["follow up during office hours", "<Hangup/>"],
        excludes: ["person who passed away", "located right now", "<Dial"],
      },
    ],
    expectedState: "WRAPUP",
    expectedIntent: "service_schedule_question",
    expectedFacts: {
      caller_name: "Kyle Finny",
      caller_phone: "603-731-5845",
      decedent_name: "Robert Finny",
      reasonForCall: "service_schedule_question",
      death_reported: false,
      urgency: "routine",
    },
    expectedCompletedToolNames: ["crm.create_intake_lead"],
    expectedCompletedToolNamesExclude: ["dispatch.create_removal_request"],
  },
];

await main();

async function main() {
  console.log(`Twilio scenario matrix smoke against ${baseUrl}`);
  console.log(`Run id: ${runId}`);
  if (signedExpected && !authToken) {
    throw new Error("TWILIO_EXPECT_SIGNED_WEBHOOK=true requires TWILIO_AUTH_TOKEN.");
  }

  const readiness = await expectTenantJson("GET", `/v1/tenants/${tenantId}/telephony/twilio/readiness`, undefined, 200);
  assertEqual(readiness.twilioReadiness?.readyForLocalTesting, true, "Twilio local readiness");
  if (signedExpected) {
    assertEqual(readiness.twilioReadiness?.readyForPublicTraffic, true, "Twilio public readiness");
  }

  for (const scenario of scenarios) {
    await runScenario(scenario);
  }

  console.log(`Twilio scenario matrix smoke passed: ${scenarios.length}/${scenarios.length} scenarios.`);
}

async function runScenario(scenario) {
  const callSid = `${runId}-${scenario.id}`;
  const initial = await postTwilioForm("/webhook", {
    CallSid: callSid,
    From: fromNumber,
    To: toNumber,
    CallStatus: "ringing",
  });
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
      assertIncludes(twiml, expected, `${scenario.id} turn ${index + 1}`);
    }
    for (const unexpected of turn.excludes ?? []) {
      assertExcludes(twiml, unexpected, `${scenario.id} turn ${index + 1}`);
    }
  }

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

  console.log(`PASS ${scenario.title}`);
  console.log(`  Call SID: ${callSid}`);
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
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body,
  });
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
