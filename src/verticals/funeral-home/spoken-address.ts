const digitWords = new Map<string, string>([
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

const smallNumberWords = new Map<string, number>([
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
]);

const tensWords = new Map<string, number>([
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
]);

const spokenNumberToken =
  "(?:zero|oh|o|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|double|triple|\\d{1,6})";
const spokenNumberSequence = `${spokenNumberToken}(?:[\\s-]+${spokenNumberToken})*`;
const addressNumberPatterns = [
  new RegExp(`^(${spokenNumberSequence})(?=\\s+[A-Za-z])`, "i"),
  new RegExp(`\\b((?:address|location)(?:\\s+is)?\\s+)(${spokenNumberSequence})(?=\\s+[A-Za-z])`, "i"),
  new RegExp(`\\b((?:located\\s+)?at\\s+)(${spokenNumberSequence})(?=\\s+[A-Za-z])`, "i"),
];

export type SpokenAddressInputDiagnostics = {
  targetFact: "pickup_address";
  captured: boolean;
  tokenCountBucket: "empty" | "short" | "medium" | "long";
  numericDigitPresent: boolean;
  spokenNumberPresent: boolean;
  streetSuffixPresent: boolean;
  addressCuePresent: boolean;
};

export function normalizeSpokenHouseNumberInAddress(transcript: string): string {
  for (const pattern of addressNumberPatterns) {
    const match = pattern.exec(transcript);
    if (!match) continue;
    const numberGroupIndex = match.length === 2 ? 1 : 2;
    const spokenNumber = match[numberGroupIndex];
    if (!spokenNumber || /^\d{1,6}$/.test(spokenNumber)) continue;
    const digits = parseSpokenHouseNumber(spokenNumber);
    if (!digits) continue;
    const start = (match.index ?? 0) + match[0].lastIndexOf(spokenNumber);
    return `${transcript.slice(0, start)}${digits}${transcript.slice(start + spokenNumber.length)}`;
  }
  return transcript;
}

export function spokenAddressInputDiagnostics(
  transcript: string,
  captured: boolean,
): SpokenAddressInputDiagnostics {
  const tokens = transcript.match(/[A-Za-z0-9]+/g) ?? [];
  return {
    targetFact: "pickup_address",
    captured,
    tokenCountBucket: tokenCountBucket(tokens.length),
    numericDigitPresent: /\d/.test(transcript),
    spokenNumberPresent: normalizeSpokenHouseNumberInAddress(transcript) !== transcript,
    streetSuffixPresent:
      /\b(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|way|place|pl|terrace|ter|parkway|pkwy)\b/i.test(
        transcript,
      ),
    addressCuePresent: /\b(?:address|location|located|at)\b/i.test(transcript),
  };
}

function parseSpokenHouseNumber(value: string): string | undefined {
  const tokens: string[] = [...(value.toLowerCase().match(/[a-z]+|\d+/g) ?? [])];
  if (tokens.length === 0) return undefined;

  if (tokens.includes("hundred") || tokens.includes("thousand")) {
    const cardinal = parseCardinalNumber(tokens);
    return validHouseNumber(cardinal == null ? undefined : String(cardinal));
  }

  const groups: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const repeat = token === "double" ? 2 : token === "triple" ? 3 : undefined;
    if (repeat) {
      const digit = digitWords.get(tokens[index + 1] ?? "");
      if (!digit) return undefined;
      groups.push(digit.repeat(repeat));
      index += 1;
      continue;
    }
    if (/^\d{1,6}$/.test(token)) {
      groups.push(token);
      continue;
    }
    const digit = digitWords.get(token);
    if (digit !== undefined) {
      groups.push(digit);
      continue;
    }
    const small = smallNumberWords.get(token);
    if (small !== undefined) {
      groups.push(String(small));
      continue;
    }
    const tens = tensWords.get(token);
    if (tens !== undefined) {
      const nextDigit = digitWords.get(tokens[index + 1] ?? "");
      if (nextDigit && nextDigit !== "0") {
        groups.push(String(tens + Number(nextDigit)));
        index += 1;
      } else {
        groups.push(String(tens));
      }
      continue;
    }
    return undefined;
  }
  return validHouseNumber(groups.join(""));
}

function parseCardinalNumber(tokens: string[]): number | undefined {
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      current += Number(token);
      continue;
    }
    const digit = digitWords.get(token);
    if (digit !== undefined) {
      current += Number(digit);
      continue;
    }
    const small = smallNumberWords.get(token);
    if (small !== undefined) {
      current += small;
      continue;
    }
    const tens = tensWords.get(token);
    if (tens !== undefined) {
      current += tens;
      continue;
    }
    if (token === "hundred") {
      current = Math.max(1, current) * 100;
      continue;
    }
    if (token === "thousand") {
      total += Math.max(1, current) * 1_000;
      current = 0;
      continue;
    }
    return undefined;
  }
  return total + current;
}

function validHouseNumber(value: string | undefined): string | undefined {
  if (!value || !/^\d{1,6}$/.test(value)) return undefined;
  return value;
}

function tokenCountBucket(count: number): SpokenAddressInputDiagnostics["tokenCountBucket"] {
  if (count === 0) return "empty";
  if (count <= 5) return "short";
  if (count <= 12) return "medium";
  return "long";
}
