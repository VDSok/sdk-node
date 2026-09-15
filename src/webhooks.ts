import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "./errors.js";
import type { components } from "./types.js";

export type WebhookEvent = components["schemas"]["WebhookEvent"];
export type WebhookEventType = components["schemas"]["WebhookEventType"];

/** Anything that can carry HTTP headers: `Headers`, Node's `req.headers`, or a plain object. */
export type HeaderLike =
  | Headers
  | Record<string, string | string[] | undefined>
  | Iterable<[string, string]>;

export interface VerifiedWebhookHeaders {
  /** Event id (`X-Webhook-Id`), stable across retries — deduplicate on it. */
  id: string | null;
  /** Event type (`X-Webhook-Event`). */
  event: string | null;
  /** Unix seconds when the delivery was sent (`X-Webhook-Timestamp`). */
  timestamp: number;
  /** The matched hex signature. */
  signature: string;
}

export const DEFAULT_TOLERANCE_SECONDS = 300;
const SIGNATURE_SCHEME = "v1";

function getHeader(headers: HeaderLike, name: string): string | undefined {
  const wanted = name.toLowerCase();
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(wanted) ?? undefined;
  }
  if (typeof (headers as Iterable<[string, string]>)[Symbol.iterator] === "function" && !isPlainObject(headers)) {
    for (const [k, v] of headers as Iterable<[string, string]>) {
      if (k.toLowerCase() === wanted) return v;
    }
    return undefined;
  }
  const rec = headers as Record<string, string | string[] | undefined>;
  for (const key of Object.keys(rec)) {
    if (key.toLowerCase() === wanted) {
      const v = rec[key];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

function isPlainObject(v: unknown): boolean {
  return Object.prototype.toString.call(v) === "[object Object]";
}

function toBytes(body: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return body;
}

/**
 * Computes `hex(HMAC-SHA256(secret, "{timestamp}.{body}"))` — the value the
 * API puts after `v1=` in `X-Webhook-Signature`. Useful for tests and for
 * building your own receivers.
 */
export function sign(secret: string, timestamp: number | string, body: string | Uint8Array | ArrayBuffer): string {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(toBytes(body)).digest("hex");
}

/**
 * Verifies a delivery. Throws `WebhookSignatureError` when a header is
 * missing, the signature does not match, or the timestamp is older/newer
 * than `tolerance` seconds. Pass the **raw** body bytes (before any JSON
 * parsing) — re-serialized JSON will not match.
 *
 * Сравнение подписи через `timingSafeEqual`: обычное `===` по строке даёт
 * атакующему тайминг-оракул на подбор HMAC.
 */
export function verify(
  secret: string,
  headers: HeaderLike,
  rawBody: string | Uint8Array | ArrayBuffer,
  tolerance: number = DEFAULT_TOLERANCE_SECONDS,
): VerifiedWebhookHeaders {
  if (!secret) throw new WebhookSignatureError("Webhook secret is empty");
  const sigHeader = getHeader(headers, "x-webhook-signature");
  const tsHeader = getHeader(headers, "x-webhook-timestamp");
  if (!sigHeader) throw new WebhookSignatureError("Missing X-Webhook-Signature header");
  if (!tsHeader) throw new WebhookSignatureError("Missing X-Webhook-Timestamp header");

  const timestamp = Number(tsHeader);
  if (!Number.isFinite(timestamp)) {
    throw new WebhookSignatureError("X-Webhook-Timestamp is not a number");
  }

  // Several comma-separated `v1=` values are accepted so a future secret
  // rotation with overlap does not break receivers.
  const candidates = sigHeader
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${SIGNATURE_SCHEME}=`))
    .map((s) => s.slice(SIGNATURE_SCHEME.length + 1));
  if (candidates.length === 0) {
    throw new WebhookSignatureError(`No ${SIGNATURE_SCHEME}= signature in X-Webhook-Signature`);
  }

  const expected = Buffer.from(sign(secret, tsHeader.trim(), rawBody), "hex");
  const matched = candidates.find((hex) => {
    if (!/^[0-9a-fA-F]+$/.test(hex)) return false;
    const given = Buffer.from(hex, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (matched === undefined) throw new WebhookSignatureError("Webhook signature mismatch");

  if (tolerance > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - timestamp) > tolerance) {
      throw new WebhookSignatureError(
        `Webhook timestamp ${timestamp} is outside the ${tolerance}s tolerance (now ${now})`,
      );
    }
  }

  return {
    id: getHeader(headers, "x-webhook-id") ?? null,
    event: getHeader(headers, "x-webhook-event") ?? null,
    timestamp,
    signature: matched,
  };
}

/**
 * Verifies the delivery (see `verify`) and returns the parsed event
 * envelope. Narrow `T` yourself when you know the event type, e.g.
 * `constructEvent<WebhookEventServer>(…)`.
 */
export function constructEvent<T extends WebhookEvent = WebhookEvent>(
  secret: string,
  headers: HeaderLike,
  rawBody: string | Uint8Array | ArrayBuffer,
  tolerance: number = DEFAULT_TOLERANCE_SECONDS,
): T {
  verify(secret, headers, rawBody, tolerance);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(toBytes(rawBody)).toString("utf8"));
  } catch (cause) {
    throw new WebhookSignatureError("Webhook body is not valid JSON", { cause });
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as WebhookEvent).type !== "string") {
    throw new WebhookSignatureError("Webhook body is not an event envelope");
  }
  return parsed as T;
}

/** Namespace-style access: `Webhooks.verify(...)`, `Webhooks.constructEvent(...)`. */
export const Webhooks = Object.freeze({ sign, verify, constructEvent, DEFAULT_TOLERANCE_SECONDS });
