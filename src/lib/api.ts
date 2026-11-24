// Calls to TrackMate's own API (the Vercel Function behind /api).

export class ApiError extends Error {
  /** HTTP status, or 0 when the server could not be reached at all. */
  readonly status: number;
  /** The JSON body of the error answer, when there was one. */
  readonly data: Record<string, unknown>;

  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }

  /** The request never reached the server: offline, or the connection dropped. */
  get offline(): boolean {
    return this.status === 0;
  }
}

const FALLBACK: Record<number, string> = {
  401: 'Sign in to continue.',
  403: 'That is not allowed.',
  404: 'TrackMate’s API was not found at this address.',
  413: 'That is too large to save.',
  429: 'Too many requests. Try again in a moment.',
};

interface Options {
  /** Let the request finish even if the page is closed meanwhile. */
  keepalive?: boolean;
  timeoutMs?: number;
}

export async function api<T>(method: 'GET' | 'POST', route: string, body?: unknown, options: Options = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  let response: Response;
  try {
    response = await fetch(`/api/${route}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive: options.keepalive,
      signal: controller.signal,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach TrackMate’s server. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = undefined;
  }
  const fields = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;
  if (!response.ok) {
    const message = typeof fields?.error === 'string' ? fields.error : FALLBACK[response.status] ?? 'The server could not do that. Try again in a moment.';
    throw new ApiError(response.status, message, fields);
  }
  // A page instead of JSON means there is no API here, for example when only the static files are being served.
  if (!fields) throw new ApiError(404, FALLBACK[404]);
  return fields as T;
}
