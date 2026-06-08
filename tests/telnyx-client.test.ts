import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTelnyxCallControlClientFromEnv,
  FetchTelnyxCallControlClient,
  NoopTelnyxCallControlClient,
  TelnyxClientConfigError,
} from "../src/providers/telephony/telnyx-client.js";

test("noop Telnyx client returns dry-run command results", async () => {
  const client = new NoopTelnyxCallControlClient();
  const results = await client.execute([
    {
      command: "answer",
      callControlId: "call-1",
      payload: {},
    },
  ]);

  assert.deepEqual(results, [
    {
      command: "answer",
      callControlId: "call-1",
      ok: true,
      statusCode: 200,
      responseBody: {
        dryRun: true,
      },
    },
  ]);
});

test("Telnyx client env factory requires API key only when execution is enabled", () => {
  assert.equal(typeof createTelnyxCallControlClientFromEnv({}).execute, "function");
  assert.throws(
    () =>
      createTelnyxCallControlClientFromEnv({
        TELNYX_EXECUTE_COMMANDS: "true",
      }),
    TelnyxClientConfigError,
  );
});

test("fetch Telnyx client executes commands against Call Control endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: { ok: true } }), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  try {
    const client = new FetchTelnyxCallControlClient({
      apiKey: "key-1",
      baseUrl: "https://example.test/v2",
    });
    const results = await client.execute([
      {
        command: "gather_using_speak",
        callControlId: "call-1",
        payload: {
          payload: "Hello",
          command_id: "cmd-1",
        },
      },
    ]);

    assert.equal(requests[0]?.url, "https://example.test/v2/calls/call-1/actions/gather_using_speak");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.equal((requests[0]?.init?.headers as Record<string, string>).authorization, "Bearer key-1");
    assert.equal(requests[0]?.init?.body, JSON.stringify({ payload: "Hello", command_id: "cmd-1" }));
    assert.equal(results[0]?.ok, true);
    assert.equal(results[0]?.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
