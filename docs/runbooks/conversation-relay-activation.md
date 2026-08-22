# Controlled ConversationRelay Activation

Use this runbook only after the account owner accepts Twilio's Predictive and Generative AI/ML Features Addendum. The first activation changes only the speech transport. It does not enable live transfers, real customer data, automated pricing, or generative caller-facing wording.

## Preconditions

- Production is green on the exact approved release while `TWILIO_VOICE_MODE=gather`.
- `TWILIO_HANDOFF_MODE=simulate` remains set. Application startup rejects any other handoff mode while ConversationRelay is enabled.
- `TWILIO_CONVERSATION_RELAY_PUBLIC_BASE_URL=wss://voice.lanternbell.com` is configured.
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

- The signed inbound webhook emits `<ConversationRelay>` with ElevenLabs, Deepgram, and interruption enabled.
- The signed public WebSocket accepts a tenant-scoped setup message.
- A pricing prompt fails closed through the deterministic TypeScript workflow.
- The completion callback hangs up without `<Gather>` or `<Dial>`.
- The persisted replay contains the structured pricing intent but no raw prompt text.
- `/health/calls` remains green after the run.

## Controlled Phone Call

After the digital smoke passes, place one inbound call from the owner's phone. Use a non-sensitive demo script and confirm:

1. The greeting uses the natural ConversationRelay voice.
2. The caller can interrupt the assistant and receive a relevant next prompt.
3. A demo escalation ends with the simulated-handoff message and does not dial another number.
4. The operator replay contains expected structured events and no raw transcript text.
5. `/health/calls` remains green.

Record the Twilio Call SID, Render release, test script, outcome, and any speech-quality observations.

## Immediate Rollback

If startup, digital smoke, phone audio, replay, or health checks fail:

1. Change `TWILIO_VOICE_MODE` back to `gather`.
2. Save and redeploy the same approved code commit.
3. Confirm the signed Twilio scenario matrix again returns `<Gather>` and passes `7/7`.
4. Confirm `/health/calls` is green before ending the drill.

Do not enable the OpenAI streaming language layer or live handoffs during this transport-only activation.
