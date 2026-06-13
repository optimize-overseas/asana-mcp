/**
 * Normalized error for any non-2xx Asana API response (after retries are
 * exhausted for retryable statuses).
 */
export class AsanaApiError extends Error {
  /** HTTP status code, or 0 for network-level failures. */
  readonly status: number;
  /** Raw response body text (may be JSON). */
  readonly body: string;
  /** Request method + path, for log context. */
  readonly request: string;
  /** Set when the server supplied a Retry-After header on a retryable status. */
  retryAfterMs?: number;

  constructor(status: number, body: string, request: string) {
    super(`Asana API ${status || 'network error'} on ${request}: ${truncate(body, 300)}`);
    this.name = 'AsanaApiError';
    this.status = status;
    this.body = body;
    this.request = request;
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
