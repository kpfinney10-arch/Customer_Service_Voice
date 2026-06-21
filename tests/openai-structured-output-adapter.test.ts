import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOpenAiStructuredOutputAdapter,
  OpenAiStructuredOutputError,
} from "../src/providers/model/openai-structured-output-adapter.js";

test("OpenAI structured output adapter sends schema request and parses output_text", async () => {
  let requestBody: any;
  const adapter = createOpenAiStructuredOutputAdapter({
    apiKey: "test-key",
    model: "gpt-test",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            caller_name: "Amanda Reed",
            decedent_name: "Thomas Reed",
          }),
        }),
        { status: 200 },
      );
    },
  });

  const response = await adapter.generateStructuredOutput({
    tenantId: "fh-demo",
    taskName: "funeral_home.first_call_fact_extraction",
    transcript: "Dad passed and I need help.",
    context: {
      activeStep: "collect_decedent",
      currentFacts: {
        caller_name: "Amanda Reed",
      },
    },
    schema: {
      type: "object",
      properties: {
        caller_name: { type: ["string", "null"] },
        decedent_name: { type: ["string", "null"] },
      },
      required: ["caller_name", "decedent_name"],
      additionalProperties: false,
    },
  });

  assert.equal(requestBody.model, "gpt-test");
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.text.format.name, "funeral_home_first_call_fact_extraction");
  assert.match(requestBody.input[1].content, /"activeStep": "collect_decedent"/);
  assert.match(requestBody.input[2].content, /Dad passed and I need help/);
  assert.equal(response.provider, "openai");
  assert.equal((response.output as { caller_name: string }).caller_name, "Amanda Reed");
});

test("OpenAI structured output adapter parses nested output content", async () => {
  const adapter = createOpenAiStructuredOutputAdapter({
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    pickup_address: "22 Cedar Street",
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
  });

  const response = await adapter.generateStructuredOutput({
    tenantId: "fh-demo",
    taskName: "funeral_home.first_call_fact_extraction",
    transcript: "Dad passed and I need help.",
    schema: { type: "object", properties: {}, additionalProperties: true },
  });

  assert.equal((response.output as { pickup_address: string }).pickup_address, "22 Cedar Street");
});

test("OpenAI structured output adapter rejects missing key and failed responses", async () => {
  assert.throws(() => createOpenAiStructuredOutputAdapter({ apiKey: "" }), OpenAiStructuredOutputError);
  assert.throws(
    () => createOpenAiStructuredOutputAdapter({ apiKey: "https://example.trycloudflare.com/webhook" }),
    OpenAiStructuredOutputError,
  );

  const adapter = createOpenAiStructuredOutputAdapter({
    apiKey: "test-key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "bad request",
          },
        }),
        { status: 400 },
      ),
  });

  await assert.rejects(
    () =>
      adapter.generateStructuredOutput({
        tenantId: "fh-demo",
        taskName: "funeral_home.first_call_fact_extraction",
        transcript: "Dad passed and I need help.",
        schema: { type: "object", properties: {}, additionalProperties: true },
      }),
    OpenAiStructuredOutputError,
  );
});
