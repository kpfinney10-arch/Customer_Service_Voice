# Controlled Voice-Quality Benchmark

## Purpose

Compare a small set of ElevenLabs voices over the real Twilio phone path without changing LanternBell's reviewed wording, deterministic workflow, transcription, privacy rules, or simulated handoff behavior.

Twilio ConversationRelay supports an optional `voice` attribute. ElevenLabs voice strings may also select a supported model and `speed_stability_similarity` tuning tuple. See [Twilio's ConversationRelay voice guide](https://www.twilio.com/docs/voice/conversationrelay/voice-configuration) and [ElevenLabs voice settings](https://elevenlabs.io/docs/api-reference/voices/settings/get).

## Fixed Controls

Keep these settings unchanged for every candidate:

- `TWILIO_VOICE_MODE=conversation_relay`
- `TWILIO_HANDOFF_MODE=simulate`
- `CALLER_LANGUAGE_MODE=reviewed`
- `TWILIO_CONVERSATION_RELAY_TTS_PROVIDER=ElevenLabs`
- `TWILIO_CONVERSATION_RELAY_TRANSCRIPTION_PROVIDER=Deepgram`
- `TWILIO_CONVERSATION_RELAY_SPEECH_MODEL=flux`
- `TWILIO_CONVERSATION_RELAY_EOT_THRESHOLD=0.85`
- `TWILIO_CONVERSATION_RELAY_INTERRUPT_SENSITIVITY=medium`
- Reviewed bundle `lanternbell-en-us-2026-09-08-v1`

Change only `TWILIO_CONVERSATION_RELAY_VOICE` between candidates.

## Candidate Matrix

| Label | Voice | Configuration value | Reason for inclusion |
| --- | --- | --- | --- |
| A | Current Twilio en-US default | unset | Exact accepted production control |
| B | Sarah | `EXAVITQu4vr4xnSDxMaL-flash_v2_5-0.95_0.50_0.80` | American, reassuring, warm, and professional |
| C | Eric | `cjVigY5qzO86Huf0OWal-flash_v2_5-0.95_0.50_0.80` | American, smooth, trustworthy, and conversational |

The candidate names, IDs, and descriptions were confirmed against ElevenLabs' public premade-voice inventory on 2026-09-08. B and C use the same model and tuning so the main changed variable is voice identity.

## Release Gate for Each Candidate

1. Set or remove only `TWILIO_CONVERSATION_RELAY_VOICE` and deploy the same application commit.
2. Require `/version` to report the expected commit.
3. Require `/health` and `/health/calls` to return HTTP 200 with zero call failures.
4. Require authenticated Twilio readiness with reviewed caller language ready and `handoffMode=simulate`.
5. Run the phone-free smoke with:

   ```bash
   export CALLER_LANGUAGE_EXPECT_STATUS=reviewed
   export TWILIO_CONVERSATION_RELAY_EXPECT_VOICE='<candidate value>'
   npm run smoke:twilio-conversation-relay
   ```

   For candidate A, omit `TWILIO_CONVERSATION_RELAY_EXPECT_VOICE`.

6. Place one non-sensitive controlled call only after the owner separately approves that candidate's phone test.
7. Stop the comparison and restore candidate A if Twilio rejects the voice, disconnects the relay, health becomes degraded, or workflow behavior changes.

## Fixed Call Script

Use the same fictional facts and natural cadence for each call:

1. `My name is Jordan Lee.`
2. `214, 555, 0123.`
3. `My father, Robert Lee, passed away at home.`
4. `123 Oak Street, Dallas, Texas, 75201.`

Do not add real customer, decedent, phone, or address information.

## Scorecard

Score each item from 1 (poor) through 5 (excellent):

| Measure | A | B | C |
| --- | ---: | ---: | ---: |
| Sounds like a real person |  |  |  |
| Warm and compassionate |  |  |  |
| Calm and trustworthy |  |  |  |
| Clear over a phone line |  |  |  |
| Natural pace and pauses |  |  |  |
| Does not sound theatrical or cheerful |  |  |  |
| Overall preference |  | 3.5 |  |

Also record any cutoffs, delayed silence, mispronunciations, repeated questions, or provider disconnects. Voice quality cannot override a workflow or health failure.

## Acceptance and Rollback

Select a candidate only when its phone-free smoke passes, its controlled call is technically clean, and the owner prefers it over the accepted production control. Keep the winning exact voice string in Render and record it in the session handoff.

Rollback is configuration-only: remove `TWILIO_CONVERSATION_RELAY_VOICE`, redeploy the same commit, rerun the default-voice phone-free smoke, and require green call health. No application rollback is needed unless the configuration feature itself fails.
