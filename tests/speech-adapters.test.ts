import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeSpeechAdapters } from "../src/providers/speech/fake-speech-adapters.js";

test("fake STT adapter transcribes mapped audio", async () => {
  const adapters = createFakeSpeechAdapters({
    transcriptByAudioBase64: {
      audio_fixture: "My name is Laura Green and my number is 555-121-3434.",
    },
  });

  const output = await adapters.stt.transcribe({
    tenantId: "fh-demo",
    callId: "call-speech-1",
    audio: {
      contentType: "audio/wav",
      bytesBase64: "audio_fixture",
    },
  });

  assert.equal(output.provider, "fake-stt");
  assert.equal(output.transcript, "My name is Laura Green and my number is 555-121-3434.");
  assert.equal(output.confidence, 0.99);
  assert.equal(output.isFinal, true);
});

test("fake TTS adapter synthesizes text into deterministic audio payload", async () => {
  const adapters = createFakeSpeechAdapters();

  const output = await adapters.tts.synthesize({
    tenantId: "fh-demo",
    callId: "call-speech-2",
    text: "I am sorry. I will help get this to the right person.",
  });

  assert.equal(output.provider, "fake-tts");
  assert.equal(output.audio.contentType, "audio/wav");
  assert.equal(
    Buffer.from(output.audio.bytesBase64, "base64").toString("utf8"),
    "I am sorry. I will help get this to the right person.",
  );
});
