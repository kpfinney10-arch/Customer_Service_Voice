import { Pool } from "pg";
import { migratePostgres } from "./postgres-schema.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("DATABASE_URL is required to run PostgreSQL migrations.");
  process.exitCode = 1;
} else {
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
  });
  try {
    await migratePostgres(pool);
    console.log("PostgreSQL migrations completed.");
  } catch (error) {
    console.error(
      "PostgreSQL migration failed.",
      error instanceof Error ? error.message : "Unknown migration error.",
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
