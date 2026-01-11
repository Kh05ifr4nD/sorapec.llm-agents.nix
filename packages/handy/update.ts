import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertString } from "../../scripts/updater/assert.ts";
import {
  calculateUrlHash,
  fetchGitHubLatestRelease,
  readJsonObjectFile,
  shouldUpdate,
  writeJsonFile,
} from "../../scripts/updater/module.ts";
import { parallelMap } from "../../scripts/updater/parallelMap.ts";
import { formatTemplate } from "../../scripts/updater/template.ts";
import type { JsonValue } from "../../scripts/updater/module.ts";

const filePatterns = {
  "x86_64-linux": "Handy_{version}_amd64.deb",
  "x86_64-darwin": "Handy_x64.app.tar.gz",
  "aarch64-darwin": "Handy_aarch64.app.tar.gz",
} as const satisfies Record<string, string>;

async function main(): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const hashesFilePath = join(scriptDirectory, "hashes.json");

  const data = await readJsonObjectFile(hashesFilePath);
  const current = data["version"];
  assertString(current, `${hashesFilePath}: version must be a string`);

  const latest = await fetchGitHubLatestRelease("cjpais", "Handy");

  console.log(`Current: ${current}, Latest: ${latest}`);

  if (!shouldUpdate(current, latest)) {
    console.log("Already up to date");
    return;
  }

  const baseUrl = `https://github.com/cjpais/Handy/releases/download/v${latest}`;
  const entries = Object.entries(filePatterns).sort(([a], [b]) => a.localeCompare(b));

  const results = await parallelMap(
    entries,
    async ([platform, pattern]) => {
      const filename = formatTemplate(pattern, { version: latest });
      const url = `${baseUrl}/${filename}`;
      console.log(`Fetching hash for ${platform}...`);
      const hash = await calculateUrlHash(url);
      return { platform, hash };
    },
    { concurrency: entries.length },
  );

  const hashes: Record<string, string> = {};
  for (const { platform, hash } of results) {
    hashes[platform] = hash;
  }

  const nextData: Record<string, JsonValue> = {
    version: latest,
    hashes,
  };
  await writeJsonFile(hashesFilePath, nextData);

  console.log(`Updated to ${latest}`);
}

if (import.meta.main) {
  await main();
}
