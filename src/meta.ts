/**
 * Метаданные ответа: request id, лимиты, sandbox. Доступны на каждом
 * результате как неперечислимое свойство `$meta` (не попадает в
 * JSON.stringify и Object.keys, чтобы не засорять данные) и на ошибках.
 */
export interface RateLimitInfo {
  /** Requests allowed per minute in the bucket this call hit (`X-RateLimit-Limit`). */
  limit: number | null;
  /** Requests left in the current window (`X-RateLimit-Remaining`). */
  remaining: number | null;
  /** Unix seconds when the window resets (`X-RateLimit-Reset`). */
  reset: number | null;
  /** Same as `reset`, as a Date. */
  resetAt: Date | null;
}

export interface ResponseMeta {
  /** Server-side `X-Request-ID`; quote it in support requests. */
  requestId: string | null;
  /** The `X-Request-ID` the SDK sent (uuid v4, new for every HTTP attempt). */
  clientRequestId: string;
  /** HTTP status of the final attempt. */
  status: number;
  rateLimit: RateLimitInfo;
  /** `true` when the response came from a test key (`X-Sandbox: true`). */
  sandbox: boolean;
  /** Seconds from `Retry-After`, when present. */
  retryAfter: number | null;
  /** `Idempotency-Key` used for the request (money endpoints), else null. */
  idempotencyKey: string | null;
  /** Number of HTTP attempts made, including retries. */
  attempts: number;
  /** All response headers. */
  headers: Headers;
}

export type WithMeta<T> = T & { readonly $meta: ResponseMeta };

function intHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Parses `Retry-After` (seconds or HTTP-date) into seconds, or null. */
export function parseRetryAfter(headers: Headers, now: number = Date.now()): number | null {
  const raw = headers.get("retry-after");
  if (raw == null || raw.trim() === "") return null;
  const asInt = Number(raw);
  if (Number.isFinite(asInt)) return Math.max(0, asInt);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

export function buildMeta(
  headers: Headers,
  status: number,
  clientRequestId: string,
  idempotencyKey: string | null,
  attempts: number,
): ResponseMeta {
  const reset = intHeader(headers, "x-ratelimit-reset");
  return {
    requestId: headers.get("x-request-id") || null,
    clientRequestId,
    status,
    rateLimit: {
      limit: intHeader(headers, "x-ratelimit-limit"),
      remaining: intHeader(headers, "x-ratelimit-remaining"),
      reset,
      resetAt: reset == null ? null : new Date(reset * 1000),
    },
    sandbox: (headers.get("x-sandbox") ?? "").toLowerCase() === "true",
    retryAfter: parseRetryAfter(headers),
    idempotencyKey,
    attempts,
    headers,
  };
}

/** Attaches `$meta` as a non-enumerable property (hidden from JSON.stringify). */
export function attachMeta<T extends object>(value: T, meta: ResponseMeta): WithMeta<T> {
  Object.defineProperty(value, "$meta", {
    value: meta,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return value as WithMeta<T>;
}

/** Reads `$meta` from any SDK result (or undefined for plain objects). */
export function getMeta(value: unknown): ResponseMeta | undefined {
  if (value && typeof value === "object" && "$meta" in value) {
    return (value as { $meta?: ResponseMeta }).$meta;
  }
  return undefined;
}
