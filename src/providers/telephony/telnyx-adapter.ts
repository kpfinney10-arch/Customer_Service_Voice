import type {
  InboundTelephonyCallInput,
  TelephonyCallEndInput,
} from "./inbound-call.js";
import type { VoiceResponse } from "./voice-response.js";

export type TelnyxWebhookPayload = {
  data?: {
    event_type?: string;
    id?: string;
    payload?: Record<string, unknown>;
  };
};

export type TelnyxWebhookTranslation =
  | {
      kind: "inbound_call";
      input: InboundTelephonyCallInput;
    }
  | {
      kind: "call_end";
      input: TelephonyCallEndInput;
    }
  | {
      kind: "ignored";
      eventType: string;
    };

export type TelnyxCommand =
  | {
      command: "speak";
      callControlId: string;
      payload: {
        payload: string;
        voice?: string;
        language?: string;
        command_id?: string;
      };
    }
  | {
      command: "gather_using_speak";
      callControlId: string;
      payload: {
        payload: string;
        command_id?: string;
      };
    }
  | {
      command: "hangup";
      callControlId: string;
      payload: {
        command_id?: string;
        cause?: string;
      };
    };

export class TelnyxWebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelnyxWebhookError";
  }
}

export function translateTelnyxWebhook(input: {
  tenantId: string;
  payload: TelnyxWebhookPayload;
}): TelnyxWebhookTranslation {
  const eventType = requiredString(input.payload.data?.event_type, "data.event_type");
  const payload = input.payload.data?.payload ?? {};
  const callControlId = requiredString(payload.call_control_id, "data.payload.call_control_id");
  const correlationId = optionalString(input.payload.data?.id);

  if (eventType === "call.initiated") {
    return {
      kind: "inbound_call",
      input: addOptionalFields(
        {
          tenantId: input.tenantId,
          provider: "telnyx",
          providerCallId: callControlId,
        },
        {
          fromPhone: optionalString(payload.from),
          toPhone: optionalString(payload.to),
          correlationId,
        },
      ),
    };
  }

  if (eventType === "call.hangup") {
    return {
      kind: "call_end",
      input: addOptionalFields(
        {
          tenantId: input.tenantId,
          provider: "telnyx",
          providerCallId: callControlId,
        },
        {
          reason: optionalString(payload.hangup_cause),
          correlationId,
        },
      ),
    };
  }

  return {
    kind: "ignored",
    eventType,
  };
}

export function createTelnyxCommands(input: {
  callControlId: string;
  voiceResponse: VoiceResponse;
  commandIdPrefix?: string;
}): TelnyxCommand[] {
  const commands: TelnyxCommand[] = [];
  let lastSay: string | undefined;

  for (const action of input.voiceResponse.actions) {
    if (action.type === "say") {
      lastSay = action.text;
      continue;
    }
    if (action.type === "listen") {
      commands.push({
        command: "gather_using_speak",
        callControlId: input.callControlId,
        payload: addOptionalFields(
          {
            payload: lastSay ?? "",
          },
          {
            command_id: commandId(input.commandIdPrefix, commands.length + 1),
          },
        ),
      });
      lastSay = undefined;
      continue;
    }
    if (action.type === "hangup") {
      if (lastSay) {
        commands.push(speakCommand(input.callControlId, lastSay, input.commandIdPrefix, commands.length + 1));
        lastSay = undefined;
      }
      commands.push({
        command: "hangup",
        callControlId: input.callControlId,
        payload: addOptionalFields(
          {},
          {
            cause: action.reason,
            command_id: commandId(input.commandIdPrefix, commands.length + 1),
          },
        ),
      });
      continue;
    }
    if (action.type === "handoff") {
      if (lastSay) {
        commands.push(speakCommand(input.callControlId, lastSay, input.commandIdPrefix, commands.length + 1));
        lastSay = undefined;
      }
    }
  }

  if (lastSay) {
    commands.push(speakCommand(input.callControlId, lastSay, input.commandIdPrefix, commands.length + 1));
  }

  return commands;
}

function speakCommand(
  callControlId: string,
  text: string,
  commandIdPrefix: string | undefined,
  index: number,
): TelnyxCommand {
  return {
    command: "speak",
    callControlId,
    payload: addOptionalFields(
      {
        payload: text,
      },
      {
        command_id: commandId(commandIdPrefix, index),
      },
    ),
  };
}

function commandId(prefix: string | undefined, index: number): string | undefined {
  return prefix ? `${prefix}-${index}` : undefined;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TelnyxWebhookError(`${field} is required.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  return value;
}

function addOptionalFields<T extends object>(
  target: T,
  fields: Record<string, string | undefined>,
): T {
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) Object.assign(target, { [key]: value });
  }
  return target;
}
