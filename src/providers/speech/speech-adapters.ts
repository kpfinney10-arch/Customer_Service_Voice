export type SpeechToTextInput = {
  tenantId: string;
  callId: string;
  audio: {
    contentType: string;
    bytesBase64: string;
  };
  languageCode?: string;
  correlationId?: string;
};

export type SpeechToTextOutput = {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  provider: string;
};

export type TextToSpeechInput = {
  tenantId: string;
  callId: string;
  text: string;
  voice?: string;
  languageCode?: string;
  correlationId?: string;
};

export type TextToSpeechOutput = {
  audio: {
    contentType: string;
    bytesBase64: string;
  };
  provider: string;
};

export type SpeechToTextAdapter = {
  transcribe: (input: SpeechToTextInput) => Promise<SpeechToTextOutput>;
};

export type TextToSpeechAdapter = {
  synthesize: (input: TextToSpeechInput) => Promise<TextToSpeechOutput>;
};

export type SpeechAdapters = {
  stt: SpeechToTextAdapter;
  tts: TextToSpeechAdapter;
};
