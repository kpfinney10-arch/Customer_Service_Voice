import crypto from "node:crypto";

export type WebhookSignatureInput = {
  provider: string;
  method: string;
  path: string;
  rawBody: string;
  headers: Headers;
};

export type WebhookSignatureVerifier = {
  verify: (input: WebhookSignatureInput) => Promise<void> | void;
};

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export class NoopWebhookSignatureVerifier implements WebhookSignatureVerifier {
  verify(): void {}
}

export class HmacWebhookSignatureVerifier implements WebhookSignatureVerifier {
  constructor(private readonly secretsByProvider: Record<string, string>) {}

  verify(input: WebhookSignatureInput): void {
    const secret = this.secretsByProvider[input.provider];
    if (!secret) return;

    const provided = input.headers.get("x-webhook-signature")?.trim();
    if (!provided) {
      throw new WebhookSignatureError("Webhook signature is required.");
    }

    const expected = createWebhookSignature({
      secret,
      method: input.method,
      path: input.path,
      rawBody: input.rawBody,
    });
    if (!constantTimeEqual(provided, expected)) {
      throw new WebhookSignatureError("Webhook signature is invalid.");
    }
  }
}

export function createWebhookSignature(input: {
  secret: string;
  method: string;
  path: string;
  rawBody: string;
}): string {
  const digest = crypto
    .createHmac("sha256", input.secret)
    .update(`${input.method.toUpperCase()} ${input.path}\n${input.rawBody}`)
    .digest("hex");
  return `sha256=${digest}`;
}

export function createWebhookSignatureVerifierFromEnv(
  env: Record<string, string | undefined> = process.env,
): WebhookSignatureVerifier {
  const secrets = parseWebhookSecrets(env.TELEPHONY_WEBHOOK_SECRETS);
  if (Object.keys(secrets).length === 0) return new NoopWebhookSignatureVerifier();
  return new HmacWebhookSignatureVerifier(secrets);
}

export function parseWebhookSecrets(value: string | undefined): Record<string, string> {
  const entries = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0) ?? [];
  const secrets: Record<string, string> = {};
  for (const entry of entries) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new WebhookSignatureError("TELEPHONY_WEBHOOK_SECRETS must use provider:secret entries.");
    }
    const provider = entry.slice(0, separatorIndex).trim();
    const secret = entry.slice(separatorIndex + 1).trim();
    if (!provider || !secret) {
      throw new WebhookSignatureError("TELEPHONY_WEBHOOK_SECRETS must use provider:secret entries.");
    }
    secrets[provider] = secret;
  }
  return secrets;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
