import process from "node:process";
import { hashOperatorPassword } from "../dist/src/security/operator-auth.js";

const options = parseArguments(process.argv.slice(2));
if (!options.email || !options.displayName) {
  console.error("Usage: npm run operator:provision -- --email user@example.com --name \"User Name\" [--tenant fh-demo] [--role owner]");
  process.exitCode = 1;
} else {
  const password = process.env.OPERATOR_PASSWORD || await readHiddenPassword("New operator password (12-128 characters): ");
  const passwordHash = await hashOperatorPassword(password);
  const output = [{
    tenantId: options.tenantId,
    email: options.email.toLowerCase(),
    displayName: options.displayName,
    passwordHash,
    role: options.role,
    active: true,
  }];
  console.log(JSON.stringify(output));
}

function parseArguments(args) {
  const values = { tenantId: "fh-demo", role: "owner" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];
    if (argument === "--email" && value) values.email = value, index += 1;
    else if (argument === "--name" && value) values.displayName = value, index += 1;
    else if (argument === "--tenant" && value) values.tenantId = value, index += 1;
    else if (argument === "--role" && value && ["owner", "operator", "viewer"].includes(value)) values.role = value, index += 1;
  }
  return values;
}

async function readHiddenPassword(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("A terminal is required. Set OPERATOR_PASSWORD only in a protected non-interactive environment.");
  }
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return await new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
    };
    const onData = (character) => {
      if (character === "\u0003") {
        cleanup();
        reject(new Error("Canceled."));
      } else if (character === "\r" || character === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
      } else if (character === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}
