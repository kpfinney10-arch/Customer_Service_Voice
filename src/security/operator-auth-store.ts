export type OperatorRole = "owner" | "operator" | "viewer";

export type OperatorPermission = "calls:read" | "access_audit:read";

export type OperatorUser = {
  userId: string;
  tenantId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: OperatorRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OperatorSession = {
  sessionId: string;
  tokenHash: string;
  userId: string;
  tenantId: string;
  role: OperatorRole;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string;
};

export type OperatorAuditEventType =
  | "LOGIN_SUCCEEDED"
  | "LOGIN_FAILED"
  | "SESSION_EXPIRED"
  | "LOGOUT_SUCCEEDED"
  | "ACCESS_DENIED"
  | "CALL_ACTIVITY_VIEWED"
  | "CALL_DETAIL_VIEWED";

export type OperatorAuditEvent = {
  auditId: string;
  tenantId?: string | undefined;
  userId?: string | undefined;
  sessionId?: string | undefined;
  eventType: OperatorAuditEventType;
  outcome: "success" | "failure";
  occurredAt: string;
  requestId?: string | undefined;
  targetId?: string | undefined;
  metadata: Record<string, string | number | boolean>;
};

export type OperatorAuthStore = {
  upsertUser: (user: OperatorUser) => Promise<void>;
  findUserByEmail: (tenantId: string, email: string) => Promise<OperatorUser | undefined>;
  findUserById: (userId: string) => Promise<OperatorUser | undefined>;
  createSession: (session: OperatorSession) => Promise<void>;
  findSessionByTokenHash: (tokenHash: string) => Promise<OperatorSession | undefined>;
  touchSession: (sessionId: string, lastSeenAt: string) => Promise<void>;
  revokeSession: (sessionId: string, revokedAt: string) => Promise<void>;
  appendAudit: (event: OperatorAuditEvent) => Promise<void>;
};

export class InMemoryOperatorAuthStore implements OperatorAuthStore {
  private readonly usersByTenantEmail = new Map<string, OperatorUser>();
  private readonly usersById = new Map<string, OperatorUser>();
  private readonly sessionsByTokenHash = new Map<string, OperatorSession>();
  private readonly sessionTokenHashById = new Map<string, string>();
  readonly auditEvents: OperatorAuditEvent[] = [];

  async upsertUser(user: OperatorUser): Promise<void> {
    this.usersByTenantEmail.set(userKey(user.tenantId, user.email), structuredClone(user));
    this.usersById.set(user.userId, structuredClone(user));
  }

  async findUserById(userId: string): Promise<OperatorUser | undefined> {
    const user = this.usersById.get(userId);
    return user ? structuredClone(user) : undefined;
  }

  async findUserByEmail(tenantId: string, email: string): Promise<OperatorUser | undefined> {
    const user = this.usersByTenantEmail.get(userKey(tenantId, email));
    return user ? structuredClone(user) : undefined;
  }

  async createSession(session: OperatorSession): Promise<void> {
    this.sessionsByTokenHash.set(session.tokenHash, structuredClone(session));
    this.sessionTokenHashById.set(session.sessionId, session.tokenHash);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<OperatorSession | undefined> {
    const session = this.sessionsByTokenHash.get(tokenHash);
    return session ? structuredClone(session) : undefined;
  }

  async touchSession(sessionId: string, lastSeenAt: string): Promise<void> {
    const tokenHash = this.sessionTokenHashById.get(sessionId);
    if (!tokenHash) return;
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (session && !session.revokedAt) session.lastSeenAt = lastSeenAt;
  }

  async revokeSession(sessionId: string, revokedAt: string): Promise<void> {
    const tokenHash = this.sessionTokenHashById.get(sessionId);
    if (!tokenHash) return;
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (session) session.revokedAt = revokedAt;
  }

  async appendAudit(event: OperatorAuditEvent): Promise<void> {
    this.auditEvents.push(structuredClone(event));
  }
}

function userKey(tenantId: string, email: string): string {
  return `${tenantId}\u0000${email.toLowerCase()}`;
}
