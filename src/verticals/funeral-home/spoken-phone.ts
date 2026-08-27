const spokenDigitValues = new Map<string, string>([
  ["zero", "0"],
  ["oh", "0"],
  ["o", "0"],
  ["one", "1"],
  ["two", "2"],
  ["three", "3"],
  ["four", "4"],
  ["five", "5"],
  ["six", "6"],
  ["seven", "7"],
  ["eight", "8"],
  ["nine", "9"],
]);

const groupedNumericPhonePattern =
  /\b(?:\+?1[-.,\s]*)?(?:\(?\d{3}\)?[-.,\s]*)\d{3}[-.,\s]*\d{4}\b/;

export function extractSpokenPhoneNumber(transcript: string): string | undefined {
  const groupedNumericPhone = transcript.match(groupedNumericPhonePattern)?.[0];
  if (groupedNumericPhone) {
    const digits = groupedNumericPhone.replace(/\D/g, "");
    const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (tenDigits.length === 10) return formatTenDigitPhone(tenDigits);
  }

  for (const digits of spokenDigitSequences(transcript)) {
    const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
    if (tenDigits.length === 10) return formatTenDigitPhone(tenDigits);
  }
  return undefined;
}

export function extractSpokenDigitSequence(transcript: string): string | undefined {
  return spokenDigitSequences(transcript)
    .filter((digits) => digits.length >= 9 && digits.length <= 12)
    .sort((left, right) => right.length - left.length)[0];
}

function spokenDigitSequences(transcript: string): string[] {
  const tokens = transcript.toLowerCase().match(/[a-z]+|\d+/g) ?? [];
  const sequences: string[] = [];
  let digits = "";
  let hasSpokenDigit = false;

  const finishSequence = (): void => {
    if (hasSpokenDigit && digits) sequences.push(digits);
    digits = "";
    hasSpokenDigit = false;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const multiplier = token === "double" ? 2 : token === "triple" ? 3 : undefined;
    if (multiplier) {
      const repeatedDigit = spokenDigitValues.get(tokens[index + 1] ?? "");
      if (repeatedDigit) {
        digits += repeatedDigit.repeat(multiplier);
        hasSpokenDigit = true;
        index += 1;
        continue;
      }
      finishSequence();
      continue;
    }

    const spokenDigit = spokenDigitValues.get(token);
    if (spokenDigit) {
      digits += spokenDigit;
      hasSpokenDigit = true;
      continue;
    }
    if (/^\d$/.test(token)) {
      digits += token;
      continue;
    }
    finishSequence();
  }
  finishSequence();
  return sequences;
}

function formatTenDigitPhone(digits: string): string {
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
