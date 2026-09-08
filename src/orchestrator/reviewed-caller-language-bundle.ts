import type {
  ReviewedCallerLanguageBundle,
} from "./caller-language.js";

export const REVIEWED_CALLER_LANGUAGE_BUNDLE_VERSION =
  "lanternbell-en-us-2026-09-08-v1";

export const REVIEWED_CALLER_LANGUAGE_BUNDLE = Object.freeze({
  version: REVIEWED_CALLER_LANGUAGE_BUNDLE_VERSION,
  language: "en-US",
  entries: Object.freeze({
    collect_caller:
      "May I have your name and the best callback phone number in case we get disconnected?",
    collect_phone:
      "What is the best callback phone number in case we get disconnected?",
    collect_name: "Thank you. May I have your name?",
    collect_decedent:
      "When you are ready, may I have the name of your loved one who passed away?",
    collect_case_reference:
      "Could you please provide the medical examiner case number?",
    collect_location: "Where is your loved one located right now?",
    retry_phone_digits:
      "I want to make sure I have the full callback number correctly. Would you please say each digit one at a time?",
    retry_address_format:
      "I am sorry, I still do not have the address clearly. Would you please say the house number one digit at a time, followed by the street name and city?",
  }),
} satisfies ReviewedCallerLanguageBundle);
