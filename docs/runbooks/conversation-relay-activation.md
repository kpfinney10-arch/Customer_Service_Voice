# Controlled ConversationRelay Activation

Use this runbook only after the account owner accepts Twilio's Predictive and Generative AI/ML Features Addendum. The first activation changes only the speech transport. Generative caller-facing wording is a later, separate switch. Neither activation enables live transfers, real customer data, or automated pricing.

## Preconditions

- Production is green on the exact approved release while `TWILIO_VOICE_MODE=gather`.
- `TWILIO_HANDOFF_MODE=simulate` remains set. Application startup rejects any other handoff mode while ConversationRelay is enabled.
- `TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL=wss://voice.lanternbell.com` is configured.
- `TWILIO_CONVERSATION_RELAY_SPEECH_MODEL=flux` and `TWILIO_CONVERSATION_RELAY_EOT_THRESHOLD=0.85` are configured.
- The Twilio Auth Token and tenant API key remain in approved secret stores and are never pasted into logs or source control.
- The owner is available to place one controlled inbound call after the digital smoke passes.

## Activation

1. Change only `TWILIO_VOICE_MODE` from `gather` to `conversation_relay` in the Render service environment.
2. Save the environment change and deploy the exact approved commit.
3. Confirm `/version`, `/health`, and `/health/calls` before sending synthetic traffic.

## Digital Acceptance

From a trusted local shell with secrets loaded:

```sh
export API_BASE_URL=https://voice.lanternbell.com
export TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL=wss://voice.lanternbell.com
export TENANT_ID=fh-demo
export TENANT_API_KEY=<cloud-tenant-api-key>
export TWILIO_AUTH_TOKEN=<Twilio-Auth-Token>
npm run smoke:twilio-conversation-relay
```

The smoke does not place a phone call. It must prove:

- The signed inbound webhook emits `<ConversationRelay>` with ElevenLabs, Deepgram Flux, an end-of-turn threshold of `0.85`, and interruption enabled.
- The signed public WebSocket accepts a tenant-scoped setup message.
- A pricing prompt fails closed through the deterministic TypeScript workflow.
- The completion callback hangs up without `<Gather>` or `<Dial>`.
- The persisted replay contains the structured pricing intent but no raw prompt text.
- `/health/calls` remains green after the run.

The release test suite must also traverse the signed ConversationRelay WebSocket with an address whose house number is transcribed as spoken words. It must verify successful address capture and verify that two unrecognized address turns trigger `retry_budget_exhausted` instead of a prompt loop.

## Controlled Phone Call

After the digital smoke passes, place one inbound call from the owner's phone. Use a non-sensitive demo script and confirm:

1. The greeting uses the natural ConversationRelay voice.
2. The caller can interrupt the assistant and receive a relevant next prompt.
3. A demo escalation ends with the simulated-handoff message and does not dial another number.
4. The operator replay contains expected structured events and no raw transcript text.
5. `/health/calls` remains green.

Record the Twilio Call SID, Render release, test script, outcome, and any speech-quality observations.

## Constrained Caller-Language Activation

Use this stage only after the transport-only controlled call passes. The deterministic TypeScript orchestrator continues to choose the state, required fact, tools, pricing outcome, handoff, and canonical response. OpenAI receives only an exact allowlisted generic canonical prompt; it does not receive the caller transcript or collected facts. Dynamic prompts containing a recognized name or address bypass OpenAI.

Preconditions:

- The exact release passes typecheck, build, and the complete automated suite with `CALLER_LANGUAGE_MODE=deterministic`.
- `OPENAI_API_KEY` is stored only as a Render secret.
- `CALLER_LANGUAGE_OPENAI_MODEL=gpt-5.6-luna` and the reviewed pricing-rate variables match the approved model price sheet.
- `CALLER_LANGUAGE_OPENAI_TIMEOUT_MS=1200` is the initial hard deadline.
- The owner approves a phone-free OpenAI request and a later non-sensitive controlled call. Real-customer data retains its separate legal/privacy gate.

Activation:

1. Change only `CALLER_LANGUAGE_MODE` from `deterministic` to `openai`.
2. Deploy the exact approved commit and verify `/version`, `/health`, and `/health/calls`.
3. Run the phone-free smoke with the generated-language acceptance flag:

```sh
export CALLER_LANGUAGE_EXPECT_STATUS=generated
npm run smoke:twilio-conversation-relay
```

4. Inspect the smoke session's `TTS_STARTED` event. It must report `languageMode=openai`, `languageStatus=generated`, positive token usage, bounded latency, an estimated micro-USD cost, and both text-retention flags as `false`.
5. Run a provider-failure drill in a non-production environment and confirm the caller receives the exact canonical TypeScript prompt with `languageStatus=fallback`.
6. Only after those checks pass, place one non-sensitive controlled call. Confirm the generated questions remain short, ask only for the expected field, and never add pricing, promises, transfers, or other requests.

Immediate language rollback:

1. Set `CALLER_LANGUAGE_MODE=deterministic`.
2. Redeploy the same code commit.
3. Run the smoke with `CALLER_LANGUAGE_EXPECT_STATUS=deterministic`.
4. Confirm call health is green. `TWILIO_VOICE_MODE=conversation_relay` may remain active if the issue is limited to OpenAI wording.

## Immediate Rollback

If startup, digital smoke, phone audio, replay, or health checks fail:

1. Change `TWILIO_VOICE_MODE` back to `gather`.
2. Save and redeploy the same approved code commit.
3. Confirm the signed Twilio scenario matrix again returns `<Gather>` and passes `7/7`.
4. Confirm `/health/calls` is green before ending the drill.

Do not enable live handoffs during either activation. Do not combine a speech-transport change and a caller-language-mode change in the same release drill.
