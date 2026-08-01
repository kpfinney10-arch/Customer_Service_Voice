import { Pool } from "pg";
import { validatePostgresRecovery } from "./postgres-recovery-validator.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required to validate a PostgreSQL recovery.");
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const validation = await validatePostgresRecovery(pool);
    console.log(JSON.stringify(validation));
    if (!validation.ok) process.exitCode = 1;
  } catch (error) {
    console.error(
      "PostgreSQL recovery validation failed.",
      error instanceof Error ? error.message : "Unknown validation error.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
