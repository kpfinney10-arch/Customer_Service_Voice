import { createApiServer, listen } from "./http-server.js";

const port = Number(process.env.PORT ?? 3000);
const server = createApiServer();
const url = await listen(server, port, "127.0.0.1");

console.log(`voice-ai-platform listening on ${url}`);
