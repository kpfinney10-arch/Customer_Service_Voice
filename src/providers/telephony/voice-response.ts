export type VoiceResponseAction =
  | {
      type: "say";
      text: string;
    }
  | {
      type: "listen";
      expectedInput: "caller_speech";
    }
  | {
      type: "handoff";
      reason: string;
      destinationType?: "on_call_phone" | "dispatch_desk_phone" | "dispatch_queue" | "manual_review";
      destination?: string;
      queue?: string;
    }
  | {
      type: "hangup";
      reason?: string;
    }
  | {
      type: "stop";
      target: "current_output";
    };

export type VoiceResponse = {
  contentType: "application/json";
  actions: VoiceResponseAction[];
};

export function createListenVoiceResponse(text: string): VoiceResponse {
  return {
    contentType: "application/json",
    actions: [
      { type: "say", text },
      { type: "listen", expectedInput: "caller_speech" },
    ],
  };
}

export function createHandoffVoiceResponse(
  text: string,
  reason: string,
  routing?: {
    destinationType: "on_call_phone" | "dispatch_desk_phone" | "dispatch_queue" | "manual_review";
    destination: string;
    queue: string;
  },
): VoiceResponse {
  const handoffAction: VoiceResponseAction = {
    type: "handoff",
    reason,
  };
  if (routing) {
    handoffAction.destinationType = routing.destinationType;
    handoffAction.destination = routing.destination;
    handoffAction.queue = routing.queue;
  }
  return {
    contentType: "application/json",
    actions: [
      { type: "say", text },
      handoffAction,
    ],
  };
}

export function createHangupVoiceResponse(reason?: string): VoiceResponse {
  const action: VoiceResponseAction = reason ? { type: "hangup", reason } : { type: "hangup" };
  return {
    contentType: "application/json",
    actions: [action],
  };
}

export function createInterruptedVoiceResponse(text: string): VoiceResponse {
  return {
    contentType: "application/json",
    actions: [
      { type: "stop", target: "current_output" },
      { type: "say", text },
      { type: "listen", expectedInput: "caller_speech" },
    ],
  };
}
