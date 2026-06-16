import { createFirstCallExtractorFromEnv } from "../dist/src/config/first-call-extractor-environment.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadLocalEnvFile(".env.local");
loadLocalEnvFile(".env");

const deterministicTranscripts = [
  {
    name: "compact-natural-answer",
    transcript: "Hi, this is Kyle. My dad John died at 123 Main Street. My number is 603-731-5845.",
    expected: {
      caller_name: "Kyle",
      decedent_name: "John",
      pickup_address: "123 Main Street",
    },
  },
  {
    name: "facility-release",
    transcript:
      "This is Megan Walsh from North Ridge Hospital. Patient Samuel Price was pronounced and is ready for release to Evergreen Funeral Home. Call 555-301-4400.",
    expected: {
      caller_name: "Megan Walsh",
      decedent_name: "Samuel Price",
      facility_name: "North Ridge Hospital",
      requested_funeral_home: "Evergreen Funeral Home",
    },
  },
  {
    name: "fragmented-followup-style",
    transcript: "My name is Amanda. My mother, Patricia, passed away. Address is 44 Cedar Road. Phone 555-808-1000.",
    expected: {
      caller_name: "Amanda",
      decedent_name: "Patricia",
      pickup_address: "44 Cedar Road",
    },
  },
];

const fallbackTranscripts = [
  {
    name: "llm-fallback-needed",
    transcript:
      "This is the overnight nurse at Green Valley Care. The resident was Henry Thompson. Please call me back at 555-410-9090. He is in room 214 and ready for the funeral home.",
    expected: {
      caller_phone: "555-410-9090",
      decedent_name: "Henry Thompson",
      facility_name: "Green Valley Care",
    },
  },
];

await main();

async function main() {
  const mode = process.env.FIRST_CALL_EXTRACTOR?.trim() || "deterministic";
  console.log(`First-call extraction smoke check using mode: ${mode}`);
  if (mode === "openai" && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required when FIRST_CALL_EXTRACTOR=openai.");
  }
  if (mode === "openai" && !process.env.FIRST_CALL_LLM_MIN_BASE_CONFIDENCE?.trim()) {
    process.env.FIRST_CALL_LLM_MIN_BASE_CONFIDENCE = "1";
    console.log("OpenAI mode: forcing fallback evaluation for smoke coverage.");
  }

  const extractor = createFirstCallExtractorFromEnv(process.env);
  const transcripts =
    mode === "deterministic" ? deterministicTranscripts : [...deterministicTranscripts, ...fallbackTranscripts];
  const results = [];

  for (const item of transcripts) {
    const output = await extractor.extract(item.transcript);
    const factHits = Object.entries(item.expected).filter(([key, value]) => output.facts?.[key] === value);
    const factMisses = Object.entries(item.expected).filter(([key, value]) => output.facts?.[key] !== value);
    results.push({
      name: item.name,
      confidence: output.confidence,
      warnings: output.warnings,
      factHits: factHits.map(([key]) => key),
      factMisses: factMisses.map(([key, value]) => ({
        key,
        expected: value,
        actual: output.facts?.[key] ?? null,
      })),
      facts: output.facts,
    });
  }

  for (const result of results) {
    console.log("");
    console.log(`Transcript: ${result.name}`);
    console.log(`Confidence: ${result.confidence}`);
    console.log(`Hits: ${result.factHits.length ? result.factHits.join(", ") : "none"}`);
    console.log(`Misses: ${result.factMisses.length ? JSON.stringify(result.factMisses) : "none"}`);
    console.log(`Warnings: ${result.warnings.length ? result.warnings.join(", ") : "none"}`);
    console.log(`Facts: ${JSON.stringify(result.facts)}`);
  }

  const totalExpected = results.reduce((sum, result) => sum + result.factHits.length + result.factMisses.length, 0);
  const totalHits = results.reduce((sum, result) => sum + result.factHits.length, 0);
  console.log("");
  console.log(`Extraction smoke complete: ${totalHits}/${totalExpected} expected facts matched.`);

  if (mode === "fake_llm" || mode === "openai") {
    assertMinimumHits(totalHits, totalExpected);
  }
}

function assertMinimumHits(totalHits, totalExpected) {
  const ratio = totalExpected === 0 ? 1 : totalHits / totalExpected;
  if (ratio < 0.7) {
    throw new Error(`Expected at least 70% extraction smoke fact matches, got ${Math.round(ratio * 100)}%.`);
  }
}

function loadLocalEnvFile(filename) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;

    process.env[key] = unquoteEnvValue(trimmed.slice(separatorIndex + 1).trim());
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
