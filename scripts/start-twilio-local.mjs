import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadLocalEnvFile(".env.local");
loadLocalEnvFile(".env");

const defaults = {
  TENANT_API_KEYS: "fh-demo:replace-with-local-dev-key",
  STORAGE_DRIVER: "file",
  STORAGE_DATA_DIR: ".voice-ai-data-twilio-local",
  TELEPHONY_WEBHOOK_SECRETS: "",
  FIRST_CALL_EXTRACTOR: "deterministic",
  OPENAI_TIMEOUT_MS: "20000",
  RATE_LIMIT_PER_WINDOW: "120",
  RATE_LIMIT_WINDOW_MS: "60000",
  SERVICE_VERSION: "local-twilio",
  SERVICE_COMMIT: "local",
  SERVICE_BUILD_TIME: new Date().toISOString(),
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]?.trim()) process.env[key] = value;
}

if (process.env.FIRST_CALL_EXTRACTOR === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
  throw new Error("OPENAI_API_KEY is required when FIRST_CALL_EXTRACTOR=openai.");
}

console.log("Starting local Twilio voice server.");
console.log(`Storage: ${process.env.STORAGE_DRIVER} (${process.env.STORAGE_DATA_DIR})`);
console.log(`Extractor: ${process.env.FIRST_CALL_EXTRACTOR}`);
console.log(
  process.env.TELEPHONY_WEBHOOK_SECRETS?.includes("twilio:")
    ? "Twilio signatures: enabled"
    : "Twilio signatures: disabled for local unsigned testing",
);
console.log("");
console.log("After startup, useful checks:");
console.log("  npm run smoke:twilio-readiness");
console.log("  npm run smoke:twilio");
console.log("  npx -y cloudflared tunnel --url http://127.0.0.1:3000");
console.log("");

const child = spawn("npm", ["start"], {
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 0;
});

function loadLocalEnvFile(filename) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
