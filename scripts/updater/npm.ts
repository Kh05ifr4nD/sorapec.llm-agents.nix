import { dirname, join } from "node:path";

import { assertRecord, assertString } from "./assert.ts";
import { type EnvironmentVariables, runChecked } from "./command.ts";
import { copyDirectory, ensureDirectory, fileExists } from "./fileSystem.ts";
import { nixStorePrefetchFile } from "./hash.ts";
import { fetchJson } from "./http.ts";

function npmRegistryLatestUrl(packageName: string): string {
  return `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
}

type NpmLatestResponse = Readonly<{
  version: string;
}>;

function parseNpmLatestResponse(data: unknown, context: string): NpmLatestResponse {
  assertRecord(data, `${context}: expected JSON object`);
  const version = data["version"];
  assertString(version, `${context}: expected version string`);
  return { version };
}

export async function fetchNpmVersion(packageName: string): Promise<string> {
  const url = npmRegistryLatestUrl(packageName);
  const data = await fetchJson(url, { headers: { "Accept": "application/json" } });
  const parsed = parseNpmLatestResponse(data, `npm latest ${packageName}`);
  return parsed.version;
}

export async function extractOrGenerateLockfile(
  tarballUrl: string,
  outputPath: string,
  options: Readonly<{ environmentVariables?: EnvironmentVariables }> = {},
): Promise<void> {
  console.log("Extracting/generating package-lock.json from tarball...");

  const prefetchResult = await nixStorePrefetchFile(tarballUrl, {
    unpack: true,
    hashType: "sha256",
  });
  const unpackedDirectoryPath = prefetchResult.storePath;

  const candidates = [
    join(unpackedDirectoryPath, "package-lock.json"),
    join(unpackedDirectoryPath, "package", "package-lock.json"),
  ];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      await ensureDirectory(dirname(outputPath));
      await Deno.copyFile(candidate, outputPath);
      console.log("Updated package-lock.json from tarball");
      return;
    }
  }

  console.log("No package-lock.json in tarball, generating...");

  const temporaryDirectoryPath = await Deno.makeTempDir();
  try {
    const workingDirectoryPath = join(temporaryDirectoryPath, "package");
    await copyDirectory(unpackedDirectoryPath, workingDirectoryPath);

    const packageJson = join(workingDirectoryPath, "package.json");
    if (!(await fileExists(packageJson))) {
      throw new Error(`package.json not found in unpacked tarball: ${packageJson}`);
    }

    const environmentVariables: Record<string, string> = {
      ...Deno.env.toObject(),
      ...(options.environmentVariables ?? {}),
      HOME: temporaryDirectoryPath,
    };

    await runChecked(
      "npm",
      ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"],
      {
        workingDirectory: workingDirectoryPath,
        environmentVariables,
      },
    );

    const generatedLockfile = join(workingDirectoryPath, "package-lock.json");
    if (!(await fileExists(generatedLockfile))) {
      throw new Error("Failed to generate package-lock.json");
    }

    await Deno.copyFile(generatedLockfile, outputPath);
    console.log("Generated package-lock.json");
  } finally {
    await Deno.remove(temporaryDirectoryPath, { recursive: true }).catch(() => undefined);
  }
}
