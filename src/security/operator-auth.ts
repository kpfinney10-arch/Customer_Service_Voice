import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type {
  OperatorAuditEvent,
  OperatorAuthStore,
  OperatorPermission,
  OperatorRole,
  OperatorSession,
  OperatorUser,
} from "./operator-auth-store.js";

const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 3;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const PASSWORD_HASH_PREFIX = "scrypt-v1";
const DEFAULT_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1_000;
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1_000;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1_000;
const LOGIN_ATTEMPT_LIMIT = 5;
const DUMMY_PASSWORD_HASH = "scrypt-v1$32768$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const OPERATOR_SESSION_COOKIE = "lb_operator_session";

const ROLE_PERMISSIONS: Readonly<Record<OperatorRole, ReadonlySet<OperatorPermission>>> = {
  owner: new Set(["calls:read", "access_audit:read"]),
  operator: new Set(["calls:read"]),
  viewer: new Set(["calls:read"]),
};

export type OperatorPrincipal = {
  userId: string;
  tenantId: string;
  role: OperatorRole;
  sessionId: string;
};

export type OperatorSessionView = OperatorPrincipal & {
  email: string;
  displayName: string;
  expiresAt: string;
};

export type OperatorAuthServiceOptions = {
  now?: () => Date;
  absoluteTtlMs?: number;
  idleTtlMs?: number;
  secureCookie?: boolean;
};

export class OperatorAuthenticationError extends Error {
  constructor(
    public readonly code: "INVALID_CREDENTIALS" | "SESSION_REQUIRED" | "SESSION_EXPIRED" | "ACCESS_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "OperatorAuthenticationError";
  }
}

export class OperatorAuthService {
  private readonly now: () => Date;
  private readonly absoluteTtlMs: number;
  private readonly idleTtlMs: number;
  private readonly secureCookie: boolean;
  private readonly loginAttempts = new Map<string, { count: number; resetAtMs: number }>();

  constructor(
    private readonly store: OperatorAuthStore,
    options: OperatorAuthServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.absoluteTtlMs = options.absoluteTtlMs ?? DEFAULT_ABSOLUTE_TTL_MS;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.secureCookie = options.secureCookie ?? true;
  }

  async login(input: {
    tenantId: string;
    email: string;
    password: string;
    requestId?: string;
  }): Promise<{ session: OperatorSessionView; setCookie: string }> {
    const tenantId = normalizeIdentifier(input.tenantId);
    const email = normalizeEmail(input.email);
    const now = this.now();
    const attemptKey = hashValue(`${tenantId}:${email}`);
    const attempts = this.loginAttempt(attemptKey, now.getTime());
    if (attempts.count >= LOGIN_ATTEMPT_LIMIT) {
      await this.audit({
        tenantId: tenantId || undefined,
        eventType: "LOGIN_FAILED",
        outcome: "failure",
        occurredAt: now.toISOString(),
        requestId: input.requestId,
        metadata: { loginHash: attemptKey, reason: "attempt_limit" },
      });
      throw new OperatorAuthenticationError("INVALID_CREDENTIALS", "The sign-in details are not valid.");
    }
    const user = await this.store.findUserByEmail(tenantId, email);
    const passwordValid = await verifyOperatorPassword(input.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !user.active || !passwordValid) {
      attempts.count += 1;
      this.loginAttempts.set(attemptKey, attempts);
      await this.audit({
        tenantId: tenantId || undefined,
        eventType: "LOGIN_FAILED",
        outcome: "failure",
        occurredAt: now.toISOString(),
        requestId: input.requestId,
        metadata: { loginHash: hashValue(`${tenantId}:${email}`), reason: "invalid_credentials" },
      });
      throw new OperatorAuthenticationError("INVALID_CREDENTIALS", "The sign-in details are not valid.");
    }

    this.loginAttempts.delete(attemptKey);

    const token = randomBytes(32).toString("base64url");
    const session: OperatorSession = {
      sessionId: randomUUID(),
      tokenHash: hashValue(token),
      userId: user.userId,
      tenantId: user.tenantId,
      role: user.role,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.absoluteTtlMs).toISOString(),
    };
    await this.store.createSession(session);
    await this.audit({
      tenantId: user.tenantId,
      userId: user.userId,
      sessionId: session.sessionId,
      eventType: "LOGIN_SUCCEEDED",
      outcome: "success",
      occurredAt: now.toISOString(),
      requestId: input.requestId,
      metadata: { role: user.role },
    });
    return {
      session: sessionView(user, session),
      setCookie: this.sessionCookie(token, this.absoluteTtlMs),
    };
  }

  async currentSession(cookieHeader: string | null | undefined): Promise<OperatorPrincipal> {
    const token = cookieValue(cookieHeader, OPERATOR_SESSION_COOKIE);
    if (!token) {
      throw new OperatorAuthenticationError("SESSION_REQUIRED", "An operator session is required.");
    }
    const session = await this.store.findSessionByTokenHash(hashValue(token));
    if (!session || session.revokedAt) {
      throw new OperatorAuthenticationError("SESSION_REQUIRED", "An operator session is required.");
    }
    const now = this.now();
    const absoluteExpired = new Date(session.expiresAt).getTime() <= now.getTime();
    const idleExpired = new Date(session.lastSeenAt).getTime() + this.idleTtlMs <= now.getTime();
    if (absoluteExpired || idleExpired) {
      await this.store.revokeSession(session.sessionId, now.toISOString());
      await this.audit({
        tenantId: session.tenantId,
        userId: session.userId,
        sessionId: session.sessionId,
        eventType: "SESSION_EXPIRED",
        outcome: "failure",
        occurredAt: now.toISOString(),
        metadata: { reason: absoluteExpired ? "absolute_timeout" : "idle_timeout" },
      });
      throw new OperatorAuthenticationError("SESSION_EXPIRED", "The operator session has expired.");
    }
    const user = await this.store.findUserById(session.userId);
    if (!user || !user.active || user.tenantId !== session.tenantId) {
      await this.store.revokeSession(session.sessionId, now.toISOString());
      throw new OperatorAuthenticationError("SESSION_REQUIRED", "An operator session is required.");
    }
    await this.store.touchSession(session.sessionId, now.toISOString());
    return {
      userId: user.userId,
      tenantId: user.tenantId,
      role: user.role,
      sessionId: session.sessionId,
    };
  }

  async requirePermission(
    cookieHeader: string | null | undefined,
    permission: OperatorPermission,
    input: { requestId?: string; targetId?: string } = {},
  ): Promise<OperatorPrincipal> {
    const principal = await this.currentSession(cookieHeader);
    if (!ROLE_PERMISSIONS[principal.role].has(permission)) {
      await this.audit({
        tenantId: principal.tenantId,
        userId: principal.userId,
        sessionId: principal.sessionId,
        eventType: "ACCESS_DENIED",
        outcome: "failure",
        occurredAt: this.now().toISOString(),
        requestId: input.requestId,
        targetId: input.targetId,
        metadata: { permission, role: principal.role },
      });
      throw new OperatorAuthenticationError("ACCESS_FORBIDDEN", "This account does not have access.");
    }
    return principal;
  }

  async logout(cookieHeader: string | null | undefined, requestId?: string): Promise<string> {
    const token = cookieValue(cookieHeader, OPERATOR_SESSION_COOKIE);
    if (token) {
      const session = await this.store.findSessionByTokenHash(hashValue(token));
      if (session && !session.revokedAt) {
        const now = this.now().toISOString();
        await this.store.revokeSession(session.sessionId, now);
        await this.audit({
          tenantId: session.tenantId,
          userId: session.userId,
          sessionId: session.sessionId,
          eventType: "LOGOUT_SUCCEEDED",
          outcome: "success",
          occurredAt: now,
          requestId,
          metadata: {},
        });
      }
    }
    return this.sessionCookie("", 0);
  }

  async auditAccess(
    principal: OperatorPrincipal,
    eventType: "CALL_ACTIVITY_VIEWED" | "CALL_DETAIL_VIEWED",
    input: { requestId?: string; targetId?: string; metadata?: Record<string, string | number | boolean> } = {},
  ): Promise<void> {
    await this.audit({
      tenantId: principal.tenantId,
      userId: principal.userId,
      sessionId: principal.sessionId,
      eventType,
      outcome: "success",
      occurredAt: this.now().toISOString(),
      requestId: input.requestId,
      targetId: input.targetId,
      metadata: input.metadata ?? {},
    });
  }

  clearCookie(): string {
    return this.sessionCookie("", 0);
  }

  private sessionCookie(token: string, maxAgeMs: number): string {
    const secure = this.secureCookie ? "; Secure" : "";
    return `${OPERATOR_SESSION_COOKIE}=${token}; Path=/; HttpOnly${secure}; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1_000)}`;
  }

  private async audit(event: Omit<OperatorAuditEvent, "auditId">): Promise<void> {
    const stored: OperatorAuditEvent = { auditId: randomUUID(), ...event };
    await this.store.appendAudit(stored);
  }

  private loginAttempt(key: string, nowMs: number): { count: number; resetAtMs: number } {
    const existing = this.loginAttempts.get(key);
    return existing && existing.resetAtMs > nowMs
      ? existing
      : { count: 0, resetAtMs: nowMs + LOGIN_ATTEMPT_WINDOW_MS };
  }
}

export async function hashOperatorPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const derived = await deriveScrypt(password, salt, SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION);
  return [
    PASSWORD_HASH_PREFIX,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyOperatorPassword(password: string, encoded: string): Promise<boolean> {
  const [prefix, costText, blockSizeText, parallelizationText, saltText, hashText] = encoded.split("$");
  if (!prefix || prefix !== PASSWORD_HASH_PREFIX || !costText || !blockSizeText || !parallelizationText || !saltText || !hashText) {
    return false;
  }
  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelization = Number(parallelizationText);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = await deriveScrypt(password, Buffer.from(saltText, "base64url"), cost, blockSize, parallelization);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new Error("Operator passwords must contain between 12 and 128 characters.");
  }
}

async function deriveScrypt(password: string, salt: Buffer, cost: number, blockSize: number, parallelization: number): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, {
      N: cost,
      r: blockSize,
      p: parallelization,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeIdentifier(value: string): string {
  return value.trim();
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function cookieValue(header: string | null | undefined, name: string): string | undefined {
  for (const part of header?.split(";") ?? []) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim() || undefined;
  }
  return undefined;
}

function principalFromSession(session: OperatorSession): OperatorPrincipal {
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    role: session.role,
    sessionId: session.sessionId,
  };
}

function sessionView(user: OperatorUser, session: OperatorSession): OperatorSessionView {
  return {
    ...principalFromSession(session),
    email: user.email,
    displayName: user.displayName,
    expiresAt: session.expiresAt,
  };
}
