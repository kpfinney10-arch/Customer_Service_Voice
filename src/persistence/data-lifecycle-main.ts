import process from "node:process";
import { Pool } from "pg";
import {
  DataLifecycleError,
  PostgresDataLifecycleService,
  type DataPurgeReason,
} from "./data-lifecycle.js";
import { migratePostgres } from "./postgres-schema.js";
import { createTwilioCallDeletionClientFromEnv } from "../providers/telephony/twilio-call-deletion.js";

type ParsedArguments = {
  command?: "tenant-purge" | "retention";
  execute: boolean;
  tenantId?: string;
  confirmedTenantId?: string;
  requestId?: string;
  requestedBy?: string;
  reason?: DataPurgeReason;
  runId?: string;
  retentionConfirmed: boolean;
};

const args = parseArguments(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  fail("DATABASE_URL_REQUIRED", "DATABASE_URL is required.");
} else if (!args.command) {
  fail("COMMAND_REQUIRED", usage());
} else {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await migratePostgres(pool);
    const providerClient = args.execute
      ? createTwilioCallDeletionClientFromEnv(process.env)
      : undefined;
    const service = new PostgresDataLifecycleService(pool, providerClient);
    if (args.command === "tenant-purge") {
      if (!args.tenantId) throw new DataLifecycleError("TENANT_REQUIRED", "--tenant is required.");
      if (!args.execute) {
        console.log(JSON.stringify(await service.previewTenantPurge(args.tenantId)));
      } else {
        if (!args.confirmedTenantId || !args.requestId || !args.requestedBy || !args.reason) {
          throw new DataLifecycleError(
            "PURGE_CONFIRMATION_REQUIRED",
            "Execution requires --confirm-tenant, --request-id, --requested-by, and --reason.",
          );
        }
        console.log(JSON.stringify(await service.executeTenantPurge({
          tenantId: args.tenantId,
          confirmedTenantId: args.confirmedTenantId,
          requestId: args.requestId,
          requestedBy: args.requestedBy,
          reason: args.reason,
          auditSecret: process.env.DATA_PURGE_AUDIT_SECRET ?? "",
        })));
      }
    } else if (!args.execute) {
      console.log(JSON.stringify(await service.previewRetention()));
    } else {
      if (!args.retentionConfirmed || !args.runId) {
        throw new DataLifecycleError(
          "RETENTION_CONFIRMATION_REQUIRED",
          "Retention execution requires --confirm RETENTION and --run-id.",
        );
      }
      console.log(JSON.stringify(await service.executeRetention({ runId: args.runId })));
    }
  } catch (error) {
    const code = error instanceof DataLifecycleError ? error.code : "DATA_LIFECYCLE_FAILED";
    const message = error instanceof Error ? error.message : "Unknown data lifecycle failure.";
    fail(code, message);
  } finally {
    await pool.end().catch(() => {});
  }
}

function parseArguments(values: string[]): ParsedArguments {
  const parsed: ParsedArguments = { execute: false, retentionConfirmed: false };
  const command = values[0];
  if (command === "tenant-purge" || command === "retention") parsed.command = command;
  for (let index = 1; index < values.length; index += 1) {
    const argument = values[index];
    const value = values[index + 1];
    if (argument === "--execute") parsed.execute = true;
    else if (argument === "--tenant" && value) parsed.tenantId = value, index += 1;
    else if (argument === "--confirm-tenant" && value) parsed.confirmedTenantId = value, index += 1;
    else if (argument === "--request-id" && value) parsed.requestId = value, index += 1;
    else if (argument === "--requested-by" && value) parsed.requestedBy = value, index += 1;
    else if (argument === "--reason" && value && isReason(value)) parsed.reason = value, index += 1;
    else if (argument === "--run-id" && value) parsed.runId = value, index += 1;
    else if (argument === "--confirm" && value) parsed.retentionConfirmed = value === "RETENTION", index += 1;
  }
  return parsed;
}

function isReason(value: string): value is DataPurgeReason {
  return value === "customer_request" || value === "tenant_offboarding" || value === "test_data_cleanup";
}

function usage(): string {
  return [
    "Preview tenant purge: npm run data:purge -- --tenant TENANT_ID",
    "Execute tenant purge: npm run data:purge -- --tenant TENANT_ID --execute --confirm-tenant TENANT_ID --request-id REQUEST_ID --requested-by USER_ID --reason customer_request",
    "Preview retention: npm run data:retention",
    "Execute retention: npm run data:retention -- --execute --confirm RETENTION --run-id RUN_ID",
  ].join("\n");
}

function fail(code: string, message: string): void {
  console.error(JSON.stringify({ error: code, message }));
  process.exitCode = 1;
}
