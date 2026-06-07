import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package exposes local human-testing smoke script", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(pkg.scripts?.["smoke:human-test"], "node scripts/human-testing-smoke.mjs");
});
