import type { TelnyxCommand } from "./telnyx-adapter.js";

export type TelnyxCommandResult = {
  command: TelnyxCommand["command"];
  callControlId: string;
  ok: boolean;
  statusCode: number;
  responseBody: unknown;
};

export type TelnyxCallControlClient = {
  execute: (commands: TelnyxCommand[]) => Promise<TelnyxCommandResult[]>;
};

export type TelnyxClientConfig = {
  apiKey: string;
  baseUrl?: string;
};

export class NoopTelnyxCallControlClient implements TelnyxCallControlClient {
  async execute(commands: TelnyxCommand[]): Promise<TelnyxCommandResult[]> {
    return commands.map((command) => ({
      command: command.command,
      callControlId: command.callControlId,
      ok: true,
      statusCode: 200,
      responseBody: {
        dryRun: true,
      },
    }));
  }
}

export class FetchTelnyxCallControlClient implements TelnyxCallControlClient {
  private readonly baseUrl: string;

  constructor(private readonly config: TelnyxClientConfig) {
    this.baseUrl = config.baseUrl?.replace(/\/$/, "") || "https://api.telnyx.com/v2";
  }

  async execute(commands: TelnyxCommand[]): Promise<TelnyxCommandResult[]> {
    const results: TelnyxCommandResult[] = [];
    for (const command of commands) {
      results.push(await this.executeOne(command));
    }
    return results;
  }

  private async executeOne(command: TelnyxCommand): Promise<TelnyxCommandResult> {
    const response = await fetch(`${this.baseUrl}/calls/${encodeURIComponent(command.callControlId)}/actions/${command.command}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command.payload),
    });
    const responseBody = await readResponseBody(response);
    return {
      command: command.command,
      callControlId: command.callControlId,
      ok: response.ok,
      statusCode: response.status,
      responseBody,
    };
  }
}

export function createTelnyxCallControlClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): TelnyxCallControlClient {
  if (env.TELNYX_EXECUTE_COMMANDS?.trim().toLowerCase() !== "true") {
    return new NoopTelnyxCallControlClient();
  }
  const apiKey = env.TELNYX_API_KEY?.trim();
  if (!apiKey) {
    throw new TelnyxClientConfigError("TELNYX_API_KEY is required when TELNYX_EXECUTE_COMMANDS=true.");
  }
  const config: TelnyxClientConfig = {
    apiKey,
  };
  if (env.TELNYX_API_BASE_URL?.trim()) config.baseUrl = env.TELNYX_API_BASE_URL.trim();
  return new FetchTelnyxCallControlClient(config);
}

export class TelnyxClientConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelnyxClientConfigError";
  }
}

async function readResponseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}
