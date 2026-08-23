import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeSpokenHouseNumberInAddress,
  spokenAddressInputDiagnostics,
} from "../src/verticals/funeral-home/spoken-address.js";

test("spoken address normalization converts digit-by-digit house numbers", () => {
  assert.equal(
    normalizeSpokenHouseNumberInAddress("six three six Commerce Avenue Keller Texas"),
    "636 Commerce Avenue Keller Texas",
  );
  assert.equal(
    normalizeSpokenHouseNumberInAddress("My loved one is at one two three Main Street"),
    "My loved one is at 123 Main Street",
  );
  assert.equal(
    normalizeSpokenHouseNumberInAddress("double six Oak Road"),
    "66 Oak Road",
  );
});

test("spoken address normalization supports grouped and cardinal house numbers", () => {
  assert.equal(
    normalizeSpokenHouseNumberInAddress("six thirty six Commerce Avenue Keller Texas"),
    "636 Commerce Avenue Keller Texas",
  );
  assert.equal(
    normalizeSpokenHouseNumberInAddress("twelve thirty six Saratoga Circle Fort Worth"),
    "1236 Saratoga Circle Fort Worth",
  );
  assert.equal(
    normalizeSpokenHouseNumberInAddress("The address is six hundred thirty six Commerce Avenue"),
    "The address is 636 Commerce Avenue",
  );
});

test("spoken address diagnostics retain input shape without retaining input text", () => {
  const diagnostics = spokenAddressInputDiagnostics(
    "six three six Commerce Avenue Keller Texas",
    false,
  );

  assert.deepEqual(diagnostics, {
    targetFact: "pickup_address",
    captured: false,
    tokenCountBucket: "medium",
    numericDigitPresent: false,
    spokenNumberPresent: true,
    streetSuffixPresent: true,
    addressCuePresent: false,
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /Commerce|Keller|six three six/i);
});
