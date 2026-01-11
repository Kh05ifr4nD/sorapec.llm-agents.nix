import { assertRecord, assertString } from "./assert.ts";
import { fetchJson } from "./http.ts";

type GitHubReleaseResponse = Readonly<{
  tagName: string;
}>;

function normalizeTag(tag: string): string {
  return tag.startsWith("v") ? tag.slice(1) : tag;
}

function parseGitHubReleaseResponse(data: unknown, context: string): GitHubReleaseResponse {
  assertRecord(data, `${context}: expected JSON object`);
  const tagName = data["tag_name"];
  assertString(tagName, `${context}: expected tag_name string`);
  return { tagName };
}

function buildGitHubHeaders(token: string | undefined): HeadersInit {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "agentNix-updater",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

function resolveGitHubToken(explicitToken?: string): string | undefined {
  return explicitToken ?? Deno.env.get("GH_TOKEN") ?? Deno.env.get("GITHUB_TOKEN") ?? undefined;
}

export async function fetchGitHubLatestRelease(
  owner: string,
  repository: string,
  options: Readonly<{ token?: string }> = {},
): Promise<string> {
  const token = resolveGitHubToken(options.token);
  const url = `https://api.github.com/repos/${owner}/${repository}/releases/latest`;
  const data = await fetchJson(url, { headers: buildGitHubHeaders(token) });
  const parsed = parseGitHubReleaseResponse(
    data,
    `GitHub latest release ${owner}/${repository}`,
  );
  return normalizeTag(parsed.tagName);
}
