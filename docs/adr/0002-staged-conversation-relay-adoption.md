# ADR 0002: Staged ConversationRelay Adoption

Status: Accepted for implementation behind a disabled production flag  
Decision date: 2026-08-18

## Context

The production demo currently uses Twilio `<Gather input="speech">` and `<Say>`. That path is signed, observable, scenario-tested, and safe, but it has turn gaps and synthetic pacing that do not meet the intended conversational experience.

Twilio ConversationRelay can provide continuous speech recognition, natural text-to-speech, interruption handling, and a low-latency WebSocket transport. Introducing it also adds a new persistent connection, provider protocol, usage charge, external AI/ML terms, and live-handoff behavior that the current HTTP callback path does not exercise.

Changing the audio transport and allowing a generative model to control conversation behavior in the same release would make failures difficult to isolate and would weaken the deterministic orchestration boundary.

## Decision

Adopt ConversationRelay in stages:

1. Keep `TWILIO_VOICE_MODE=gather` as the production default and rollback path.
2. Add a tenant-scoped, signed ConversationRelay WebSocket transport behind `TWILIO_VOICE_MODE=conversation_relay`.
3. Route final caller prompts into the existing deterministic TypeScript orchestrator. The orchestrator continues to own state, facts, rules, tools, pricing containment, and terminal actions.
4. Use ConversationRelay only with `TWILIO_HANDOFF_MODE=simulate` until the ConversationRelay completion callback and live transfer path receive separate acceptance testing.
5. Do not store raw prompt text in durable events. Existing structured-fact retention and redacted transcript-event rules remain unchanged.
6. Treat interruptions as explicit orchestrator events and serialize prompts per connection.
7. Fail terminal, invalid, or provider-error paths closed through a small allowlisted `reasonCode`; never place caller data, transcript text, or structured facts in `handoffData`.
8. Add a constrained OpenAI response-generation layer only after the transport passes digital and real-phone tests. The first release buffers one short structured response before speaking it, so the application can validate the complete wording. The LLM may rewrite only exact allowlisted generic prompts; it may not receive caller transcripts or collected facts, choose state transitions, invoke integrations directly, bypass pricing policy, or authorize handoffs. Dynamic prompts containing a recognized name or address remain deterministic.
9. Keep caller-language generation behind `CALLER_LANGUAGE_MODE=deterministic|openai`, default it to `deterministic`, and fall back to the canonical TypeScript prompt on timeout, provider error, schema failure, semantic-anchor failure, extra questions, or prohibited content.
10. Record latency, token usage, and model-rate cost estimates in a content-free `TTS_STARTED` event. Do not retain the canonical or generated wording in that event.

## Initial Voice Configuration

- TTS provider: ElevenLabs through ConversationRelay.
- Transcription provider: Deepgram through ConversationRelay.
- Speech model: Deepgram Flux, with an end-of-turn threshold of `0.85` to reduce premature mid-sentence cutoffs while preserving responsive barge-in.
- Language: `en-US`.
- Caller speech may interrupt synthesized speech.
- Interruption sensitivity starts at `medium` and must be tuned from controlled calls.

These are tested defaults, not permanent vendor commitments. They remain environment-configurable.

## Activation Gates

ConversationRelay may not be enabled on the production number until all of the following are complete:

- Twilio ConversationRelay onboarding and the applicable AI/ML addendum are accepted by the account owner.
- The signed WebSocket handshake, setup, prompt, interruption, error, disconnect, and completion paths pass digitally.
- The production deployment is verified with `TWILIO_VOICE_MODE=gather` before any switch.
- A controlled real-phone call passes in simulated-handoff mode.
- Call health and operator replay remain green and free of transcript text.
- Rollback to `gather` is timed and verified.
- The measured ConversationRelay and model usage is added to the pricing model.
- The OpenAI caller-language path passes a phone-free production smoke with `languageStatus=generated`; its timeout/fallback path is also verified before a controlled call.

Live handoffs and real customer data retain their existing separate approval gates.

## Consequences

- The first ConversationRelay release improves the speech transport and barge-in behavior without changing business decisions.
- Natural generative wording is a separate, measurable release rather than a hidden part of the transport migration.
- The initial language release favors complete-output validation over direct token streaming. Streaming may be evaluated later only if measured latency requires it and equivalent safeguards remain enforceable.
- The application adds a WebSocket dependency and must account for long-lived connections during shutdown and capacity testing.
- The safe rollback is a single environment change to `TWILIO_VOICE_MODE=gather` followed by deployment.

## Official References

- [Twilio ConversationRelay](https://www.twilio.com/docs/voice/conversationrelay)
- [ConversationRelay WebSocket messages](https://www.twilio.com/docs/voice/conversationrelay/websocket-messages)
- [ConversationRelay TwiML reference](https://www.twilio.com/docs/voice/twiml/connect/conversationrelay)
- [OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model)
