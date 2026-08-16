import { mkdir, writeFile } from "node:fs/promises";

const outputPath = "dist/build-metadata.json";
const commit =
  process.env.SERVICE_COMMIT?.trim() ||
  process.env.RENDER_GIT_COMMIT?.trim() ||
  "local";
const metadata = {
  commit,
  buildTime: new Date().toISOString(),
};

await mkdir("dist", { recursive: true });
await writeFile(outputPath, `${JSON.stringify(metadata)}\n`, {
  encoding: "utf8",
  mode: 0o644,
});
