import type { ResponseMeta, RateLimitInfo } from "./meta.js";
import type { components } from "./types.js";

export type ErrorCode = components["schemas"]["ErrorCode"];
export type ErrorBody = components["schemas"]["Error"];

/** Base class of everything the SDK throws. */
export class VdsokError extends Error {
  /** Server `X-Request-ID` when the failure came with a response. */
  readonly requestId: string | null;

  constructor(message: string, options: { requestId?: string | null; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.requestId = options.requestId ?? null;
  }
}

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown> | null;
  meta: ResponseMeta;
  /** Raw response body (parsed JSON or text) for debugging. */
  body: unknown;
}

/**
 * A non-2xx answer from the API in the `{error: {code, message, request_id,
 * details}}` envelope. Subclasses map HTTP statuses; `code` narrows further
 * (see `ErrorCode`). Unknown statuses still produce an `ApiError`, so
 * always check `status`/`code` rather than relying on `instanceof` alone.
 */
export class ApiError extends VdsokError {
  readonly status: number;
  /** Machine-readable code from the closed list; unknown codes are passed through. */
  readonly code: ErrorCode | (string & {});
  readonly details: Record<string, unknown> | null;
  readonly meta: ResponseMeta;
  readonly body: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message, { requestId: init.meta.requestId });
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.meta = init.meta;
    this.body = init.body;
  }

  get rateLimit(): RateLimitInfo {
    return this.meta.rateLimit;
  }

  /** Seconds to wait before retrying (`Retry-After`), when the server said so. */
  get retryAfter(): number | null {
    return this.meta.retryAfter;
  }

  /** The `Idempotency-Key` that was sent — reuse it to retry safely. */
  get idempotencyKey(): string | null {
    return this.meta.idempotencyKey;
  }

  override toString(): string {
    const rid = this.requestId ? ` request_id=${this.requestId}` : "";
    return `${this.name}: [${this.status} ${this.code}] ${this.message}${rid}`;
  }
}

/** 400 — `invalid_request`, `validation_error`, `invalid_cursor`, `idempotency_key_required`, … */
export class BadRequestError extends ApiError {
  /** Per-field problems from `validation_error` (`details.fields`). */
  get fields(): Record<string, string> {
    const f = this.details?.fields;
    return f && typeof f === "object" ? (f as Record<string, string>) : {};
  }
}

/** 401 — `invalid_token`, `key_expired`, `key_not_yet_valid`. */
export class AuthenticationError extends ApiError {}

/** 402 — `insufficient_funds`. Nothing was charged; `details` carries the figures. */
export class InsufficientFundsError extends ApiError {
  get required(): string | null {
    return str(this.details?.required);
  }
  get balance(): string | null {
    return str(this.details?.balance);
  }
  get shortfall(): string | null {
    return str(this.details?.shortfall);
  }
  get currency(): string | null {
    return str(this.details?.currency);
  }
}

/** 403 — `insufficient_scope`, `ip_not_allowed`, `account_suspended`, `sandbox_not_supported`, `server_blocked`, … */
export class PermissionError extends ApiError {
  /** Scopes the key lacks (`insufficient_scope`). */
  get requiredScopes(): string[] {
    const r = this.details?.required;
    return Array.isArray(r) ? r.map(String) : [];
  }
}

/** 404 — `not_found` (also for objects owned by another account). */
export class NotFoundError extends ApiError {}

/** 409 — `conflict`, `idempotency_conflict`, `operation_in_progress`, `no_capacity`, `domain_taken`, … */
export class ConflictError extends ApiError {}

/** 429 — `rate_limited`; look at `retryAfter` and `rateLimit`. */
export class RateLimitError extends ApiError {}

/** 500 — `server_error`. */
export class ServerError extends ApiError {}

/** 502 / 504 — the panel, registrar or gateway failed or timed out (`upstream_error`, `upstream_timeout`). */
export class UpstreamError extends ApiError {}

/** 503 — `api_disabled`, `upstream_unavailable`, `temporarily_unavailable`. */
export class ServiceUnavailableError extends ApiError {}

/** The request never produced an HTTP response (DNS, TCP, TLS, reset). */
export class ConnectionError extends VdsokError {}

/** The request exceeded `timeout` (per attempt). */
export class TimeoutError extends ConnectionError {}

/** A webhook delivery failed signature or timestamp checks. */
export class WebhookSignatureError extends VdsokError {}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

/**
 * Picks the error class by HTTP status. `code` is kept on the instance; the
 * class hierarchy exists so callers can `catch` broad categories.
 */
export function errorClassFor(status: number): typeof ApiError {
  switch (status) {
    case 400:
      return BadRequestError;
    case 401:
      return AuthenticationError;
    case 402:
      return InsufficientFundsError;
    case 403:
      return PermissionError;
    case 404:
      return NotFoundError;
    case 409:
      return ConflictError;
    case 429:
      return RateLimitError;
    case 500:
      return ServerError;
    case 502:
    case 504:
      return UpstreamError;
    case 503:
      return ServiceUnavailableError;
    default:
      return ApiError;
  }
}

/** Builds the right `ApiError` subclass from a parsed (or unparsable) error body. */
export function buildApiError(status: number, body: unknown, meta: ResponseMeta): ApiError {
  const envelope = (body as Partial<ErrorBody> | null)?.error;
  const code = typeof envelope?.code === "string" ? envelope.code : fallbackCode(status);
  const message =
    typeof envelope?.message === "string" && envelope.message
      ? envelope.message
      : typeof body === "string" && body
        ? body.slice(0, 200)
        : `HTTP ${status}`;
  const details =
    envelope?.details && typeof envelope.details === "object"
      ? (envelope.details as Record<string, unknown>)
      : null;
  // Заголовок X-Request-ID главнее, но если прокси его срезал — берём
  // request_id из тела: для поддержки важен любой из них.
  const bodyRequestId = typeof envelope?.request_id === "string" ? envelope.request_id : null;
  const effectiveMeta = meta.requestId == null && bodyRequestId ? { ...meta, requestId: bodyRequestId } : meta;
  const Cls = errorClassFor(status);
  return new Cls({ status, code, message, details, meta: effectiveMeta, body });
}

function fallbackCode(status: number): string {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
      return "invalid_token";
    case 402:
      return "insufficient_funds";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 413:
      return "payload_too_large";
    case 415:
      return "unsupported_media_type";
    case 429:
      return "rate_limited";
    case 502:
      return "upstream_error";
    case 503:
      return "temporarily_unavailable";
    case 504:
      return "upstream_timeout";
    default:
      return status >= 500 ? "server_error" : "unknown";
  }
}
