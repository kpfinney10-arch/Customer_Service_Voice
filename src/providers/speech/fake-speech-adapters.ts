import type {
  SpeechAdapters,
  SpeechToTextAdapter,
  SpeechToTextOutput,
  TextToSpeechAdapter,
  TextToSpeechOutput,
} from "./speech-adapters.js";

export type FakeSpeechAdapterOptions = {
  transcriptByAudioBase64?: Record<string, string>;
  defaultTranscript?: string;
};

export function createFakeSpeechAdapters(options: FakeSpeechAdapterOptions = {}): SpeechAdapters {
  return {
    stt: createFakeSpeechToTextAdapter(options),
    tts: createFakeTextToSpeechAdapter(),
  };
}

export function createFakeSpeechToTextAdapter(
  options: FakeSpeechAdapterOptions = {},
): SpeechToTextAdapter {
  return {
    async transcribe(input): Promise<SpeechToTextOutput> {
      const transcript =
        options.transcriptByAudioBase64?.[input.audio.bytesBase64] ??
        options.defaultTranscript ??
        decodeFakeAudio(input.audio.bytesBase64);
      return {
        transcript,
        confidence: 0.99,
        isFinal: true,
        provider: "fake-stt",
      };
    },
  };
}

export function createFakeTextToSpeechAdapter(): TextToSpeechAdapter {
  return {
    async synthesize(input): Promise<TextToSpeechOutput> {
      return {
        audio: {
          contentType: "audio/wav",
          bytesBase64: Buffer.from(input.text, "utf8").toString("base64"),
        },
        provider: "fake-tts",
      };
    },
  };
}

function decodeFakeAudio(bytesBase64: string): string {
  return Buffer.from(bytesBase64, "base64").toString("utf8");
}
