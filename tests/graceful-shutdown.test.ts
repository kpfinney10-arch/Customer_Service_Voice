import assert from "node:assert/strict";
import type http from "node:http";
import { test } from "node:test";
import { closeHttpServer, installGracefulShutdown } from "../src/api/graceful-shutdown.js";
import type { LifecycleLog, Logger } from "../src/observability/logger.js";
import type { CallEvent } from "../src/events/call-event.js";

test("closeHttpServer closes a listening HTTP server", async () => {
  const server = new FakeHttpServer();

  const result = await closeHttpServer(server as unknown as http.Server, 1_000);

  assert.equal(result.ok, true);
  assert.equal(result.timedOut, false);
  assert.equal(server.closeCalled, true);
  assert.equal(typeof result.durationMs, "number");
});

test("installGracefulShutdown logs lifecycle and exits after signal", async () => {
  const server = new FakeHttpServer();
  const logger = new TestLogger();
  const target = new FakeSignalTarget();
  const exitCode = new Promise<number>((resolve) => {
    installGracefulShutdown({
      server: server as unknown as http.Server,
      logger,
      processTarget: target,
      timeoutMs: 1_000,
      exit: resolve,
    });
  });

  target.emit("SIGTERM");

  assert.equal(await exitCode, 0);
  assert.deepEqual(
    logger.lifecycleEntries.map((entry) => entry.type),
    ["shutdown_started", "shutdown_completed"],
  );
  assert.equal(logger.lifecycleEntries[0]?.signal, "SIGTERM");
  assert.equal(logger.errors.length, 0);
});

class FakeHttpServer {
  closeCalled = false;

  close(callback?: (error?: Error) => void): this {
    this.closeCalled = true;
    queueMicrotask(() => callback?.());
    return this;
  }

  closeAllConnections(): void {}
}

class FakeSignalTarget {
  private readonly listeners = new Map<NodeJS.Signals, (signal: NodeJS.Signals) => void>();

  once(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): void {
    this.listeners.set(signal, listener);
  }

  off(signal: NodeJS.Signals): void {
    this.listeners.delete(signal);
  }

  emit(signal: NodeJS.Signals): void {
    this.listeners.get(signal)?.(signal);
  }
}

class TestLogger implements Logger {
  readonly lifecycleEntries: LifecycleLog[] = [];
  readonly errors: Array<{ message: string; context?: Record<string, unknown> }> = [];

  event(_event: CallEvent): void {}

  request(): void {}

  lifecycle(entry: LifecycleLog): void {
    this.lifecycleEntries.push(entry);
  }

  error(message: string, context?: Record<string, unknown>): void {
    const error = { message };
    if (context !== undefined) Object.assign(error, { context });
    this.errors.push(error);
  }
}
