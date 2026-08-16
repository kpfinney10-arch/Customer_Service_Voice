import type { CallRecordDeletionClient } from "../../persistence/data-lifecycle.js";

const ACCOUNT_SID_PATTERN = /^AC[0-9a-f]{32}$/i;
const CALL_SID_PATTERN = /^CA[0-9a-f]{32}$/i;

export class TwilioCallDeletionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TwilioCallDeletionError";
  }
}

export function createTwilioCallDeletionClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): CallRecordDeletionClient | undefined {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid && !authToken) return undefined;
  if (!accountSid || !ACCOUNT_SID_PATTERN.test(accountSid) || !authToken) {
    throw new TwilioCallDeletionError(
      "TWILIO_DELETION_CONFIG_INVALID",
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are both required for call-record deletion.",
    );
  }
  return createTwilioCallDeletionClient({ accountSid, authToken, fetchImpl });
}

export function createTwilioCallDeletionClient(input: {
  accountSid: string;
  authToken: string;
  fetchImpl?: typeof fetch;
}): CallRecordDeletionClient {
  if (!ACCOUNT_SID_PATTERN.test(input.accountSid) || !input.authToken) {
    throw new TwilioCallDeletionError(
      "TWILIO_DELETION_CONFIG_INVALID",
      "Valid Twilio deletion credentials are required.",
    );
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    async deleteCall(callSid) {
      if (!CALL_SID_PATTERN.test(callSid)) {
        throw new TwilioCallDeletionError(
          "TWILIO_CALL_SID_INVALID",
          "Refusing to delete an invalid Twilio Call SID.",
        );
      }
      const credentials = Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64");
      const response = await fetchImpl(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Calls/${encodeURIComponent(callSid)}.json`,
        {
          method: "DELETE",
          headers: { Authorization: `Basic ${credentials}` },
        },
      );
      if (response.status === 204 || response.status === 404) return;
      throw new TwilioCallDeletionError(
        "TWILIO_CALL_DELETE_FAILED",
        `Twilio call-record deletion failed with HTTP ${response.status}.`,
      );
    },
  };
}
