import { assertRecord, assertString } from "./assert.ts";
import { runCaptureChecked } from "./command.ts";

export const dummySha256Hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" as const;

export type PrefetchResult = Readonly<{
  hash: string;
  storePath: string;
}>;

function parsePrefetchResult(data: unknown, context: string): PrefetchResult {
  assertRecord(data, `${context}: expected JSON object`);
  const hash = data["hash"];
  const storePath = data["storePath"];
  assertString(hash, `${context}: expected hash string`);
  assertString(storePath, `${context}: expected storePath string`);
  return { hash, storePath };
}

export async function nixStorePrefetchFile(
  url: string,
  options: Readonly<{ unpack?: boolean; hashType?: string }> = {},
): Promise<PrefetchResult> {
  const argumentList = ["store", "prefetch-file", "--json"];
  if (options.hashType) {
    argumentList.push("--hash-type", options.hashType);
  }
  if (options.unpack) {
    argumentList.push("--unpack");
  }
  argumentList.push(url);

  const output = await runCaptureChecked("nix", argumentList);
  const parsed: unknown = JSON.parse(output.stdout);
  return parsePrefetchResult(parsed, "nix store prefetch-file");
}

export async function calculateUrlHash(
  url: string,
  options: Readonly<{ unpack?: boolean }> = {},
): Promise<string> {
  const prefetchOptions: { unpack?: boolean; hashType: string } = { hashType: "sha256" };
  if (options.unpack !== undefined) {
    prefetchOptions.unpack = options.unpack;
  }
  const result = await nixStorePrefetchFile(url, prefetchOptions);
  return result.hash;
}

export function extractHashFromBuildError(output: string): string | null {
  const patterns = [
    /got:\s+(sha256-[A-Za-z0-9+/=]+)/,
    /got\s+(sha256-[A-Za-z0-9+/=]+)/,
    /actual:\s+(sha256-[A-Za-z0-9+/=]+)/,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}
