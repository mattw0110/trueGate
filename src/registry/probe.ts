import { fetch } from 'undici';

export interface ProbeResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  err?: string;
}

/**
 * Lightweight GET probe with a hard timeout. Used both by `truegate status`
 * (for liveness) and by the upstream registry (to enumerate available models
 * via `/v1/models` / `/api/tags`).
 */
export async function probe(
  url: string,
  options: {
    timeoutMs?: number;
    headers?: Record<string, string>;
    parseJson?: boolean;
  } = {},
): Promise<ProbeResult> {
  const { timeoutMs = 3000, headers, parseJson = false } = options;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      ...(headers ? { headers } : {}),
    });
    const result: ProbeResult = { ok: res.ok, status: res.status };
    if (parseJson && res.ok) {
      try {
        result.body = await res.json();
      } catch {
        /* swallow parse error; still mark probe ok at the http level */
      }
    }
    return result;
  } catch (err) {
    return { ok: false, err: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(t);
  }
}
