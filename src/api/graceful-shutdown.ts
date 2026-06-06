import type http from "node:http";
import type { Logger } from "../observability/logger.js";

export type GracefulShutdownResult = {
  ok: boolean;
  durationMs: number;
  timedOut: boolean;
  errorMessage?: string;
};

export type ProcessSignalTarget = {
  once: (signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
  off: (signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void) => unknown;
};

export type GracefulShutdownOptions = {
  server: http.Server;
  logger: Pick<Logger, "lifecycle" | "error">;
  timeoutMs?: number;
  signals?: NodeJS.Signals[];
  processTarget?: ProcessSignalTarget;
  exit?: (code: number) => void;
};

export async function closeHttpServer(
  server: http.Server,
  timeoutMs = 5_000,
): Promise<GracefulShutdownResult> {
  const startedAt = Date.now();

  return await new Promise<GracefulShutdownResult>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.closeAllConnections?.();
      resolve({
        ok: false,
        durationMs: Date.now() - startedAt,
        timedOut: true,
        errorMessage: "Timed out while closing HTTP server.",
      });
    }, timeoutMs);

    server.close((error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) {
        resolve({
          ok: false,
          durationMs: Date.now() - startedAt,
          timedOut: false,
          errorMessage: error.message,
        });
        return;
      }
      resolve({
        ok: true,
        durationMs: Date.now() - startedAt,
        timedOut: false,
      });
    });
  });
}

export function installGracefulShutdown(options: GracefulShutdownOptions): () => void {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const signals = options.signals ?? ["SIGINT", "SIGTERM"];
  const target = options.processTarget ?? process;
  const exit = options.exit ?? ((code) => process.exit(code));
  let shuttingDown = false;

  const handlers = new Map<NodeJS.Signals, (signal: NodeJS.Signals) => void>();
  for (const signal of signals) {
    const handler = (receivedSignal: NodeJS.Signals): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      void shutdown({
        server: options.server,
        logger: options.logger,
        signal: receivedSignal,
        timeoutMs,
        exit,
      });
    };
    handlers.set(signal, handler);
    target.once(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) {
      target.off(signal, handler);
    }
  };
}

async function shutdown(input: {
  server: http.Server;
  logger: Pick<Logger, "lifecycle" | "error">;
  signal: NodeJS.Signals;
  timeoutMs: number;
  exit: (code: number) => void;
}): Promise<void> {
  input.logger.lifecycle({
    type: "shutdown_started",
    signal: input.signal,
  });
  const result = await closeHttpServer(input.server, input.timeoutMs);
  if (result.ok) {
    input.logger.lifecycle({
      type: "shutdown_completed",
      signal: input.signal,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    });
    input.exit(0);
    return;
  }

  input.logger.lifecycle({
    type: "shutdown_failed",
    signal: input.signal,
    durationMs: result.durationMs,
    timedOut: result.timedOut,
  });
  input.logger.error("HTTP server did not shut down cleanly.", {
    signal: input.signal,
    errorMessage: result.errorMessage,
  });
  input.exit(1);
}
