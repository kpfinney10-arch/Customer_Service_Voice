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

export function createHandoffVoiceResponse(text: string, reason: string): VoiceResponse {
  return {
    contentType: "application/json",
    actions: [
      { type: "say", text },
      { type: "handoff", reason },
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
