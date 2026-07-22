import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = process.env.LANTERNBELL_RUNTIME_DIR?.trim() ||
  join(homedir(), "Library", "Application Support", "LanternBell");
const voiceRuntime = join(runtimeRoot, "voice-ai");
const runtimeScripts = join(voiceRuntime, "scripts");
const runtimeBin = join(runtimeRoot, "bin");

const requiredPaths = [
  join(sourceRoot, "dist", "src", "api", "main.js"),
  join(sourceRoot, "scripts", "start-twilio-local.mjs"),
  join(sourceRoot, ".env.local"),
  join(sourceRoot, "node_modules", "cloudflared", "bin", "cloudflared"),
];

for (const path of requiredPaths) {
  if (!existsSync(path)) throw new Error(`Required deployment input is missing: ${path}`);
}

mkdirSync(runtimeRoot, { recursive: true, mode: 0o700 });
mkdirSync(voiceRuntime, { recursive: true, mode: 0o700 });
mkdirSync(runtimeScripts, { recursive: true, mode: 0o700 });
mkdirSync(runtimeBin, { recursive: true, mode: 0o700 });
chmodSync(runtimeRoot, 0o700);
chmodSync(voiceRuntime, 0o700);
chmodSync(runtimeBin, 0o700);

const runtimeDist = join(voiceRuntime, "dist");
rmSync(runtimeDist, { recursive: true, force: true });
cpSync(join(sourceRoot, "dist"), runtimeDist, { recursive: true });

copyFileSync(
  join(sourceRoot, "scripts", "start-twilio-local.mjs"),
  join(runtimeScripts, "start-twilio-local.mjs"),
);
copyFileSync(join(sourceRoot, ".env.local"), join(voiceRuntime, ".env.local"));
chmodSync(join(voiceRuntime, ".env.local"), 0o600);

const cloudflaredTarget = join(runtimeBin, "cloudflared");
copyFileSync(join(sourceRoot, "node_modules", "cloudflared", "bin", "cloudflared"), cloudflaredTarget);
chmodSync(cloudflaredTarget, 0o700);

const sourceData = join(sourceRoot, ".voice-ai-data-twilio-local");
const runtimeData = join(voiceRuntime, ".voice-ai-data-twilio-local");
if (existsSync(sourceData) && !existsSync(runtimeData)) {
  cpSync(sourceData, runtimeData, { recursive: true });
}

console.log(`LanternBell voice runtime deployed to ${voiceRuntime}`);
console.log(`Cloudflare runtime deployed to ${cloudflaredTarget}`);
