import { createHash } from "node:crypto";
import type { OperatorAuthStore, OperatorRole, OperatorUser } from "./operator-auth-store.js";

export class OperatorUsersConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorUsersConfigError";
  }
}

export function parseOperatorUsers(value: string | undefined, now = new Date()): OperatorUser[] {
  if (!value?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new OperatorUsersConfigError("OPERATOR_USERS_JSON must contain valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new OperatorUsersConfigError("OPERATOR_USERS_JSON must be an array.");
  }
  return parsed.map((entry, index) => parseUser(entry, index, now));
}

export async function synchronizeOperatorUsers(store: OperatorAuthStore, users: OperatorUser[]): Promise<void> {
  for (const user of users) await store.upsertUser(user);
}

function parseUser(value: unknown, index: number, now: Date): OperatorUser {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperatorUsersConfigError(`OPERATOR_USERS_JSON[${index}] must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  const tenantId = requiredString(entry.tenantId, index, "tenantId");
  const email = requiredString(entry.email, index, "email").toLowerCase();
  const displayName = requiredString(entry.displayName, index, "displayName");
  const passwordHash = requiredString(entry.passwordHash, index, "passwordHash");
  const role = parseRole(entry.role, index);
  const timestamp = now.toISOString();
  return {
    userId: optionalString(entry.userId) ?? stableUserId(tenantId, email),
    tenantId,
    email,
    displayName,
    passwordHash,
    role,
    active: entry.active === undefined ? true : parseBoolean(entry.active, index, "active"),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function stableUserId(tenantId: string, email: string): string {
  return `operator-${createHash("sha256").update(`${tenantId}:${email}`).digest("hex").slice(0, 24)}`;
}

function requiredString(value: unknown, index: number, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new OperatorUsersConfigError(`OPERATOR_USERS_JSON[${index}].${field} is required.`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseRole(value: unknown, index: number): OperatorRole {
  if (value === "owner" || value === "operator" || value === "viewer") return value;
  throw new OperatorUsersConfigError(`OPERATOR_USERS_JSON[${index}].role must be owner, operator, or viewer.`);
}

function parseBoolean(value: unknown, index: number, field: string): boolean {
  if (typeof value === "boolean") return value;
  throw new OperatorUsersConfigError(`OPERATOR_USERS_JSON[${index}].${field} must be a boolean.`);
}
