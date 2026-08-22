import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractSpokenDigitSequence,
  extractSpokenPhoneNumber,
} from "../src/verticals/funeral-home/spoken-phone.js";

test("spoken phone normalization accepts digit words and repeat words", () => {
  assert.equal(
    extractSpokenPhoneNumber("six zero three, seven three one, five eight four five"),
    "603-731-5845",
  );
  assert.equal(
    extractSpokenPhoneNumber("one six oh three seven three one five eight four five"),
    "603-731-5845",
  );
  assert.equal(
    extractSpokenPhoneNumber("six zero three seven three one five double eight five"),
    "603-731-5885",
  );
});

test("spoken phone normalization rejects incomplete and oversized sequences", () => {
  assert.equal(extractSpokenPhoneNumber("six zero three seven three one five eight four"), undefined);
  assert.equal(
    extractSpokenPhoneNumber("six zero three seven three one five eight four five six seven"),
    undefined,
  );
  assert.equal(extractSpokenPhoneNumber("I have one question for the funeral home"), undefined);
  assert.equal(
    extractSpokenDigitSequence("My number is six zero three seven three one five eight four"),
    "603731584",
  );
});
