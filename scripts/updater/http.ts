export type FetchOptions = Readonly<{
  headers?: HeadersInit;
  timeoutMilliseconds?: number;
}>;

async function fetchWithTimeout(url: string, options: FetchOptions): Promise<Response> {
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    return await fetch(url, {
      headers: options.headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${response.status} ${response.statusText} for ${url}${body ? `\n${body}` : ""}`,
    );
  }
  return await response.text();
}

export async function fetchJson(url: string, options: FetchOptions = {}): Promise<unknown> {
  const text = await fetchText(url, options);
  return JSON.parse(text) as unknown;
}
