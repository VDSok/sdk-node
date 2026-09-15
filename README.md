# @vdsok/sdk

[![npm](https://img.shields.io/npm/v/%40vdsok%2Fsdk)](https://www.npmjs.com/package/@vdsok/sdk)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/node/v/%40vdsok%2Fsdk)](https://nodejs.org)
[![API docs](https://img.shields.io/badge/docs-vdsok.guru%2Fdevelopers-blue)](https://vdsok.guru/developers)

Official Node.js / TypeScript client for the [VDSok Client API v1](https://vdsok.guru/developers):
balance and invoices, the VDS catalog, servers (order, renew, power, reinstall,
IPs, PTR, SSH keys, delete with refund), domains, API keys and webhooks.

- Zero runtime dependencies, global `fetch` — Node.js 18+.
- ESM and CommonJS, full TypeScript types generated from the OpenAPI spec.
- Retries with `Retry-After`, automatic `Idempotency-Key` on money endpoints,
  cursor pagination, typed errors, webhook signature verification.

Source: <https://github.com/VDSok/sdk-node> · Guide and reference: <https://vdsok.guru/developers> ·
Spec: `GET https://vdsok.guru/api/v1/openapi.json`

## Install

```bash
npm install @vdsok/sdk
```

## Quick start

```ts
import { Vdsok } from "@vdsok/sdk";

const client = new Vdsok(process.env.VDSOK_API_KEY); // vk_live_… or vk_test_…

const me = await client.me();
console.log(me.livemode, me.scopes);

const balance = await client.balance.get();
console.log(`${balance.balance} ${balance.currency}`, balance.$meta.requestId);

for await (const server of await client.servers.list({ status: "active" })) {
  console.log(server.id, server.name, server.primary_ip);
}
```

CommonJS works too:

```js
const { Vdsok } = require("@vdsok/sdk");
```

API keys are created in the cabinet (`/my/api`). A `vk_test_…` key reads the
real account data and **simulates** every write (no money moves, no VM is
created) — use it to develop against production safely. Every response to a
test key has `$meta.sandbox === true`.

## Configuration

```ts
const client = new Vdsok("vk_live_…", {
  baseUrl: "https://vdsok.guru/api/v1", // default
  timeout: 30_000,                       // per attempt, ms
  maxRetries: 2,                         // 429/502/503/504 and connection errors
  maxRetryDelay: 30_000,                 // longest Retry-After the SDK will wait for
  headers: { "X-Trace": "…" },          // extra headers on every request
  fetch: customFetch,                    // proxies, polyfills, tests
});
```

The key can also come from `VDSOK_API_KEY`: `new Vdsok()`.

Every method takes an optional last argument with per-call overrides:

```ts
await client.servers.get(2001, {}, { timeout: 5_000, maxRetries: 0, signal: ac.signal });
```

## Results and `$meta`

Every result is the JSON object from the API plus a non-enumerable `$meta`
(hidden from `JSON.stringify` and `Object.keys`):

```ts
const s = await client.servers.get(2001);
s.$meta.requestId;            // "9f1c2a9d-4b7e-4a21-8d3f-0c6e5b2a1d44" — quote it in support requests
s.$meta.rateLimit.remaining;  // requests left in this minute
s.$meta.rateLimit.resetAt;    // Date
s.$meta.sandbox;              // true for test keys
s.$meta.idempotencyKey;       // on money endpoints
s.$meta.attempts;             // HTTP attempts incl. retries
```

Money is a decimal **string** (`"5.90"`), timestamps are RFC 3339 strings in
UTC. Neither is converted on the way out: the object you get back is exactly
the JSON the API sent, so the generated types stay true and
`JSON.stringify(result)` still equals the response body. (The Python and PHP
SDKs do convert, because `Decimal` and `DateTimeImmutable` are lossless there;
`Date` is not a safe home for money and JavaScript has no decimal type.)

Convert explicitly when you need native values — `parseTimestamp` handles the
nullable fields too:

```ts
import { parseTimestamp } from "@vdsok/sdk";

parseTimestamp(server.created_at);             // Date
parseTimestamp(server.flags.protected_until);  // null
```

Query filters go the other way for free: `since` / `until` accept a `Date`.

## Errors

All errors extend `VdsokError`. API responses become an `ApiError` subclass by
HTTP status, with `status`, `code`, `message`, `requestId`, `details`,
`rateLimit`, `retryAfter`:

| HTTP | Class | Typical `code` |
| --- | --- | --- |
| 400 | `BadRequestError` (`.fields`) | `validation_error`, `invalid_cursor`, `os_not_allowed` |
| 401 | `AuthenticationError` | `invalid_token`, `key_expired` |
| 402 | `InsufficientFundsError` (`.required`, `.balance`, `.shortfall`) | `insufficient_funds` |
| 403 | `PermissionError` (`.requiredScopes`) | `insufficient_scope`, `ip_not_allowed`, `sandbox_not_supported`, `server_blocked` |
| 404 | `NotFoundError` | `not_found` |
| 409 | `ConflictError` | `no_capacity`, `domain_taken`, `idempotency_conflict`, `operation_in_progress` |
| 429 | `RateLimitError` | `rate_limited` |
| 500 | `ServerError` | `server_error` |
| 502 / 504 | `UpstreamError` | `upstream_error`, `upstream_timeout` |
| 503 | `ServiceUnavailableError` | `api_disabled`, `temporarily_unavailable` |
| — | `ConnectionError`, `TimeoutError` | no HTTP response |
| — | `WebhookSignatureError` | webhook verification failed |

```ts
import { InsufficientFundsError, ApiError } from "@vdsok/sdk";

try {
  await client.servers.create({ tariff_id: 12, os: "ubuntu-24.04" });
} catch (err) {
  if (err instanceof InsufficientFundsError) {
    console.log(`Top up ${err.shortfall} ${err.currency}`);
  } else if (err instanceof ApiError) {
    console.log(err.status, err.code, err.requestId);
  } else throw err;
}
```

## Retries and idempotency

- `GET` requests are retried on 429, 502, 503, 504 and connection failures,
  waiting for `Retry-After` when present (exponential backoff otherwise).
- Money endpoints (`x-idempotent` in the spec: top-ups, paying invoices,
  ordering / renewing / deleting servers, buying IPs, registering / renewing /
  transferring domains) get a uuid4 `Idempotency-Key` automatically and are
  retried the same way with the **same** key, so a retry replays the stored
  answer instead of charging twice. Pass your own key to span retries across
  processes:

  ```ts
  const res = await client.servers.renew(2001, { months: 3 }, { idempotencyKey: `renew-2001-${period}` });
  ```

  On failure the key is on the error (`err.idempotencyKey`).
- Other mutations (power, reinstall, PATCH, PTR…) are never retried.

## Pagination

Lists return a `Page<T>` with `data`, `nextCursor`, `hasMore`, and helpers:

```ts
const page = await client.invoices.list({ status: "not_paid", limit: 100 });
page.data;                          // first page
for await (const inv of page) {}    // every item, all pages
for await (const p of page.pages()) {}
const next = await page.nextPage(); // Page | null
const first200 = await page.toArray(200);
```

Cursors are opaque and signed; the SDK passes them back with the original
filters — never build one by hand.

## Resources

### Meta

```ts
await client.health();   // { status: "ok" | "disabled", time, version }
await client.me();       // { key, account_id, livemode, scopes, available_scopes, sandbox_enabled, api_version }
```

### Account and balance

```ts
const account = await client.account.get();            // account:read
const balance = await client.balance.get();            // balance:read
const info = await client.balance.topupInfo();         // { min, max, currency, gateways: string[] }

for await (const tx of await client.balance.transactions({ direction: "debit", since: new Date("2026-09-01") })) {
  console.log(tx.created_at, tx.amount, tx.description);
}

// gateways are plain codes: ["cryptobot", "heleket", …]
const topup = await client.balance.topup({ amount: info.min, gateway: info.gateways[0] }); // balance:topup
console.log(topup.payment_url);
```

### Invoices

```ts
const unpaid = await client.invoices.list({ status: "not_paid" });     // invoices:read
const inv = await client.invoices.get(10231);

const paid = await client.invoices.pay(10231);                          // invoices:pay, idempotent
console.log(paid.status, paid.balance_after);                           // always "paid"; provisioning, if any, runs in the background

const link = await client.invoices.paymentLink(10231, { gateway: "cryptobot" });

const pdf = await client.invoices.pdf(10231);
await fs.promises.writeFile(pdf.filename ?? "invoice.pdf", pdf.data);
```

### Catalog

Any valid key, no scope needed.

```ts
const { data: tariffs } = await client.catalog.tariffs({ location_id: 1 });
const tariff = await client.catalog.tariff(12);
const { data: images } = await client.catalog.os({ tariff_id: 12 });
const { data: locations } = await client.catalog.locations();
const { data: zones } = await client.catalog.zones();

const quote = await client.catalog.quote({ tariff_id: 12, months: 3, promo_code: "WELCOME" });
console.log(quote.total, quote.currency, quote.balance_sufficient);
```

### Servers

```ts
// Order (servers:order). 201 → ServerCreated with a one-time root_password,
// 202 → Order in "provisioning" when the panel is slow.
const res = await client.servers.create({ tariff_id: 12, os: "ubuntu-24.04", name: "web-01", months: 1, ssh_key_ids: [3] });
if ("server" in res) {
  console.log(res.server.id, res.root_password);
} else {
  const order = await client.servers.orders.wait(res.invoice_id); // polls GET /orders/{invoice_id}
  console.log(order.status, order.server_id);                       // "active" | "cancelled" (refunded)
}

const list = await client.servers.list({ status: "active" });        // servers:read
const detail = await client.servers.get(2001, { include: "live" });  // + refund_quote, + live
const live = await client.servers.status(2001);                      // power, cpu, memory, disk

await client.servers.update(2001, { auto_renew: true, notes: "prod" }); // servers:manage
await client.servers.renew(2001, { months: 3 });                        // servers:order, idempotent

const quote = await client.servers.refundQuote(2001);
const gone = await client.servers.delete(2001);                         // servers:delete, idempotent
console.log(gone.refund, gone.balance_after);      // refund is the amount; refund_quote explains it
```

#### Actions

```ts
await client.servers.actions.start(2001);                  // servers:manage
await client.servers.actions.stop(2001);
await client.servers.actions.restart(2001);
await client.servers.actions.power(2001, "restart");

const r = await client.servers.actions.reinstall(2001, { os: "debian-12", ssh_key_ids: [3] });
console.log(r.root_password);                              // only when generated by VDSok

const p = await client.servers.actions.resetPassword(2001);
console.log(p.password);
```

#### IPs and PTR

```ts
const { data: ips } = await client.servers.ips.list(2001);       // servers:read
const q = await client.servers.ips.quote(2001);                  // prorated price now
const added = await client.servers.ips.add(2001);                // servers:order, idempotent
console.log(added.charged, added.days);                          // the address arrives asynchronously
const extra = (await client.servers.ips.list(2001)).data.find((ip) => !ip.primary)!;
const rec = await client.servers.ips.setPtr(2001, extra.id, "mail.example.com"); // servers:manage
console.log(rec.id, rec.ptr);                                    // setPtr(…, "") removes the record
await client.servers.ips.delete(2001, extra.id);                 // no refund
```

#### Orders

```ts
const orders = await client.servers.orders.list({ status: "provisioning" });
const order = await client.servers.orders.get(10231);
const done = await client.servers.orders.wait(10231, { intervalMs: 5_000, timeoutMs: 600_000 });
```

### SSH keys

```ts
const { data: keys } = await client.sshKeys.list();                          // servers:read
const key = await client.sshKeys.create({ name: "laptop", public_key: "ssh-ed25519 AAAA… user@laptop" }); // servers:manage
await client.sshKeys.delete(key.id);                                         // resolves with ResponseMeta
```

### Domains

```ts
const avail = await client.domains.checkAvailability("example.com");  // domains:read
if (avail.available) {
  const reg = await client.domains.register({ name: "example.com", years: 1, privacy: true }); // domains:order, idempotent
  console.log(reg.status, reg.domain, reg.domain_id);                 // "registered" | "pending"
  // auto-renew is a separate PATCH /domains/{id} after the purchase
}

const domains = await client.domains.list({ status: "active" });
const d = await client.domains.get(77);
await client.domains.update(77, { privacy: false });                  // domains:manage
await client.domains.setNameservers(77, ["ns1.example.net", "ns2.example.net"]);
await client.domains.renew(77, 1);                                    // domains:order, idempotent
await client.domains.transfer({ name: "example.org", auth_code: "AbC-123-xyz" }); // 202 transfer_pending
```

### API keys

```ts
const keys = await client.keys.list();            // keys:read, never the secret — a Page
const k = await client.keys.get(3);
const gone = await client.keys.revokeSelf();      // kill switch: revokes the calling key, any scopes
console.log(gone.status, gone.key.active);        // "revoked" false
```

### Webhooks

Live keys only (`webhooks:manage`).

```ts
const hook = await client.webhooks.create({
  url: "https://hooks.example.com/vdsok",
  events: ["server.created", "server.terminated", "invoice.paid", "balance.low"],
  description: "billing sync",
});
console.log(hook.secret);                          // whsec_…, shown once

const { data: types } = await client.webhooks.events();
const hooks = await client.webhooks.list();                    // a Page
await client.webhooks.get(hook.id);
await client.webhooks.update(hook.id, { active: true });       // re-enable after auto-disable
const rotated = await client.webhooks.rotateSecret(hook.id);   // { id, secret } — old one dead
const ping = await client.webhooks.test(hook.id);              // { delivery, ok, status, latency_ms, detail }

for await (const d of await client.webhooks.deliveries(hook.id, { status: "dead" })) {
  const full = await client.webhooks.delivery(d.id);           // + payload, the exact bytes sent
  const again = await client.webhooks.redeliver(d.id);         // 202 { status: "queued", delivery }
}
await client.webhooks.delete(hook.id);                         // { status: "deleted", id }
```

#### Receiving webhooks

Verify with the **raw** body bytes; re-serialized JSON will not match.

```ts
import express from "express";
import { Webhooks, WebhookSignatureError } from "@vdsok/sdk";

const app = express();
app.post("/vdsok", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = Webhooks.constructEvent(process.env.WEBHOOK_SECRET!, req.headers, req.body); // tolerance 300 s
    switch (event.type) {
      case "server.suspended":
        console.log("suspended", event.data.object.id, "was", event.data.previous?.status);
        break;
      case "invoice.paid":
        break;
    }
    res.sendStatus(200);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return res.sendStatus(400);
    throw err;
  }
});
```

Plain `node:http`:

```ts
import { createServer } from "node:http";
import { Webhooks } from "@vdsok/sdk";

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    try {
      const { id, event } = Webhooks.verify(process.env.WEBHOOK_SECRET!, req.headers, Buffer.concat(chunks));
      // deduplicate on `id` — retries and redeliveries reuse it
      res.writeHead(200).end();
    } catch {
      res.writeHead(400).end();
    }
  });
}).listen(8080);
```

`Webhooks.verify(secret, headers, rawBody, tolerance = 300)` checks
`X-Webhook-Signature: v1=<hex HMAC-SHA256(secret, "{ts}.{body}")>` in constant
time and rejects deliveries whose `X-Webhook-Timestamp` is more than
`tolerance` seconds from now (`0` disables the check). `constructEvent` does
the same and returns the parsed envelope. Headers may be a `Headers` object,
Node's `req.headers`, or a plain object.

## TypeScript

All request and response shapes are exported by name (`Server`, `Invoice`,
`ServerCreate`, `WebhookEventServer`, …) together with the raw
`paths` / `components` / `operations` from `openapi-typescript`:

```ts
import type { Server, ServerCreate, WebhookEvent, components } from "@vdsok/sdk";
```

Advanced calls go through `client.request()`, which keeps auth, retries and
error mapping:

```ts
const { data, meta } = await client.request<{ status: string }>({ method: "GET", path: "/health" });
```

## Development

```bash
npm install
npm run gen     # src/types.ts from ../../docs/openapi/vdsok-client-api-v1.yaml (or VDSOK_OPENAPI=<path|url>)
npm run build   # dist/ (ESM + CJS + .d.ts) via tsup
npm test        # vitest against a local node:http fixture server
```

## License

[MIT](./LICENSE) © VDSok
