import crypto from "node:crypto";

export type IdempotencyRecord = {
  tenantId: string;
  key: string;
  fingerprint: string;
  statusCode: number;
  body: object;
  createdAt: string;
};

export type IdempotencyStore = {
  get: (tenantId: string, key: string) => Promise<IdempotencyRecord | undefined> | IdempotencyRecord | undefined;
  save: (record: IdempotencyRecord) => Promise<void> | void;
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different request.");
    this.name = "IdempotencyConflictError";
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  get(tenantId: string, key: string): IdempotencyRecord | undefined {
    return this.records.get(recordKey(tenantId, key));
  }

  save(record: IdempotencyRecord): void {
    this.records.set(recordKey(record.tenantId, record.key), record);
  }
}

export async function resolveIdempotentOperation(input: {
  store: IdempotencyStore;
  tenantId: string;
  key: string | undefined;
  method: string;
  path: string;
  body: object;
  execute: () => Promise<{ statusCode: number; body: object }> | { statusCode: number; body: object };
}): Promise<{ statusCode: number; body: object; idempotencyStatus?: "stored" | "replayed" }> {
  if (!input.key) {
    return await input.execute();
  }

  const fingerprint = createRequestFingerprint({
    method: input.method,
    path: input.path,
    body: input.body,
  });
  const existing = await input.store.get(input.tenantId, input.key);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throw new IdempotencyConflictError();
    }
    return {
      statusCode: existing.statusCode,
      body: existing.body,
      idempotencyStatus: "replayed",
    };
  }

  const output = await input.execute();
  await input.store.save({
    tenantId: input.tenantId,
    key: input.key,
    fingerprint,
    statusCode: output.statusCode,
    body: output.body,
    createdAt: new Date().toISOString(),
  });
  return { ...output, idempotencyStatus: "stored" };
}

function createRequestFingerprint(input: { method: string; path: string; body: object }): string {
  return crypto
    .createHash("sha256")
    .update(`${input.method.toUpperCase()} ${input.path}\n${stableStringify(input.body)}`)
    .digest("hex");
}

function recordKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
