# Changelog

All notable changes to `@vdsok/sdk` are recorded here. The SDK follows the
VDSok Client API: 1.x tracks `/api/v1`; a breaking API change becomes `/v2`
and a new major version of this package.

## 1.0.0

First public release, covering the whole Client API v1.

- `Vdsok` client: `Authorization: Bearer`, `Accept`, `User-Agent
  vdsok-sdk-node/<version>` and a uuid4 `X-Request-ID` on every request;
  per-attempt timeout (30 s) and up to 2 retries on 429/502/503/504 and
  connection failures, honouring `Retry-After`. Only `GET` and operations
  that carry an `Idempotency-Key` are retried.
- Automatic `Idempotency-Key` (uuid4) on money endpoints: top-ups, paying
  invoices, ordering/renewing/deleting servers, buying IPs, registering,
  renewing and transferring domains. The key is exposed as
  `$meta.idempotencyKey` and on errors so a caller can retry safely.
- Resource groups: `account`, `balance`, `invoices`, `catalog`, `servers`
  (with `actions`, `ips`, `orders` incl. `orders.wait()`), `domains`,
  `sshKeys`, `keys`, `webhooks`; `client.me()` and `client.health()`.
- `$meta` on every result and `ApiError`: `requestId`, `rateLimit`
  (`limit`, `remaining`, `reset`, `resetAt`), `sandbox`, `retryAfter`,
  `attempts`.
- Typed errors by HTTP status: `BadRequestError`, `AuthenticationError`,
  `InsufficientFundsError`, `PermissionError`, `NotFoundError`,
  `ConflictError`, `RateLimitError`, `ServerError`, `UpstreamError`,
  `ServiceUnavailableError`, plus `ConnectionError`/`TimeoutError` and
  `WebhookSignatureError`.
- Cursor pagination via `Page<T>`: `for await`, `pages()`, `nextPage()`,
  `toArray(max)`. Lists that carry a `next_cursor` are pages, including
  `keys.list()` and `webhooks.list()`, whose cursor is `null` for now.
- `parseTimestamp()` / `formatTimestamp()` helpers. Money and timestamps are
  left as the API sent them (decimal strings, RFC 3339); unlike the Python and
  PHP SDKs the Node one does not convert on the way out, because JavaScript
  has no decimal type and converting would break the generated types.
- `Webhooks.verify(secret, headers, rawBody, tolerance = 300)` and
  `Webhooks.constructEvent(...)` with constant-time signature comparison.
- Types generated from `docs/openapi/vdsok-client-api-v1.yaml` with
  `openapi-typescript`; ESM and CommonJS builds; zero runtime dependencies;
  Node.js 18+.
