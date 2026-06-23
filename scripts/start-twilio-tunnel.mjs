import { spawn } from "node:child_process";

const tenantId = env("TENANT_ID", "fh-demo");
const localUrl = env("LOCAL_TWILIO_URL", "http://127.0.0.1:3000");
const cloudflaredArgs = ["-y", "cloudflared", "tunnel", "--url", localUrl];

let shuttingDown = false;
let publicUrlPrinted = false;

console.log("Starting local Twilio voice server and Cloudflare quick tunnel.");
console.log("Press Ctrl-C to stop both processes.");
console.log("");

const server = spawn("npm", ["run", "start:twilio-local"], {
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

const tunnel = spawn("npx", cloudflaredArgs, {
  env: process.env,
  stdio: ["inherit", "pipe", "pipe"],
});

pipeWithPrefix(server.stdout, "server");
pipeWithPrefix(server.stderr, "server");
pipeWithPrefix(tunnel.stdout, "tunnel", inspectTunnelOutput);
pipeWithPrefix(tunnel.stderr, "tunnel", inspectTunnelOutput);

server.on("exit", (code, signal) => {
  if (shuttingDown) return;
  console.log(`server exited (${signal ?? code ?? 0}); stopping tunnel.`);
  shutdown(code ?? 1);
});

tunnel.on("exit", (code, signal) => {
  if (shuttingDown) return;
  console.log(`tunnel exited (${signal ?? code ?? 0}); stopping server.`);
  shutdown(code ?? 1);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}

function inspectTunnelOutput(text) {
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (!match || publicUrlPrinted) return;
  publicUrlPrinted = true;
  const publicUrl = match[0];
  console.log("");
  console.log("Twilio tunnel is ready.");
  console.log(`Base URL: ${publicUrl}`);
  console.log(`Webhook URL: ${publicUrl}/v1/tenants/${tenantId}/telephony/twilio/webhook`);
  console.log(`Readiness URL: ${publicUrl}/v1/tenants/${tenantId}/telephony/twilio/readiness`);
  console.log("Twilio Voice method: HTTP POST");
  console.log("");
}

function pipeWithPrefix(stream, prefix, onText) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    const text = String(chunk);
    onText?.(text);
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) console.log(`[${prefix}] ${line}`);
    }
  });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [server, tunnel]) {
    if (!child.killed) child.kill("SIGINT");
  }
  setTimeout(() => {
    process.exit(code);
  }, 250);
}

function env(name, fallback) {
  return process.env[name]?.trim() || fallback;
}
