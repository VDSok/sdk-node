import { getEventListeners } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ApiError,
  AuthenticationError,
  BadRequestError,
  ConflictError,
  ConnectionError,
  InsufficientFundsError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  ServerError,
  ServiceUnavailableError,
  TimeoutError,
  UpstreamError,
  Vdsok,
  VdsokError,
  getMeta,
  USER_AGENT,
} from "../src/index.js";
import { FixtureServer, TEST_KEY, UUID_RE, apiError, sampleServer } from "./helpers/fixture.js";

let fx: FixtureServer;
let client: Vdsok;

beforeEach(async () => {
  fx = new FixtureServer();
  await fx.start();
  client = new Vdsok(TEST_KEY, { baseUrl: fx.baseUrl, maxRetries: 2, timeout: 5_000 });
});

afterEach(async () => {
  await fx.stop();
});

describe("constructor", () => {
  it("requires a key, falling back to VDSOK_API_KEY", () => {
    const prev = process.env.VDSOK_API_KEY;
    delete process.env.VDSOK_API_KEY;
    try {
      expect(() => new Vdsok()).toThrow(VdsokError);
      expect(() => new Vdsok("   ")).toThrow(/API key/);
      process.env.VDSOK_API_KEY = "vk_live_envkey";
      const c = new Vdsok();
      expect(c.isTestKey).toBe(false);
      expect(c.keyHint).toBe("vk_live_…vkey");
    } finally {
      if (prev === undefined) delete process.env.VDSOK_API_KEY;
      else process.env.VDSOK_API_KEY = prev;
    }
  });

  it("uses the production base URL by default and strips trailing slashes", () => {
    expect(new Vdsok(TEST_KEY).baseUrl).toBe("https://vdsok.guru/api/v1");
    expect(new Vdsok(TEST_KEY, { baseUrl: "http://x/api/v1///" }).baseUrl).toBe("http://x/api/v1");
    expect(client.isTestKey).toBe(true);
  });
});

describe("headers", () => {
  it("sends Authorization, Accept, User-Agent and a uuid4 X-Request-ID", async () => {
    fx.on("GET", "/me", { body: { account_id: 57, livemode: false, scopes: [], sandbox_enabled: true, api_version: "1" } });
    const me = await client.me();
    expect(me.account_id).toBe(57);
    expect(me.livemode).toBe(false);
    const req = fx.requests[0]!;
    expect(req.headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(req.headers.accept).toBe("application/json");
    expect(req.headers["user-agent"]).toBe(USER_AGENT);
    expect(req.headers["user-agent"]).toMatch(/^vdsok-sdk-node\/\d+\.\d+\.\d+$/);
    expect(req.headers["x-request-id"]).toMatch(UUID_RE);
    expect(me.$meta.clientRequestId).toBe(req.headers["x-request-id"]);
    expect(req.headers["idempotency-key"]).toBeUndefined();
  });

  it("uses a fresh X-Request-ID for every request", async () => {
    fx.on("GET", "/health", { body: { status: "ok", time: "2026-09-15T10:00:00Z", version: "1" } });
    const h = await client.health();
    expect(h.version).toBe("1");
    await client.health();
    const ids = fx.requests.map((r) => r.headers["x-request-id"]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("passes extra headers but never lets them override Authorization, in any case", async () => {
    // Заголовки регистронезависимы: "AUTHORIZATION" и "authorization" должны
    // отсекаться так же, как каноническое написание, иначе fetch склеит два
    // значения в один заголовок через запятую.
    const c = new Vdsok(TEST_KEY, {
      baseUrl: fx.baseUrl,
      headers: { "X-Trace": "abc", Authorization: "Bearer hacked", AUTHORIZATION: "Bearer hacked2", authorization: "Bearer hacked3" },
    });
    fx.on("GET", "/health", { body: { status: "ok" } });
    await c.health({ headers: { "X-Per-Call": "1", AuThOrIzAtIoN: "Bearer hacked4" } });
    const req = fx.requests[0]!;
    expect(req.headers["x-trace"]).toBe("abc");
    expect(req.headers["x-per-call"]).toBe("1");
    expect(req.headers.authorization).toBe(`Bearer ${TEST_KEY}`);
  });

  it("sends JSON bodies with Content-Type and serialises query params", async () => {
    fx.on("PATCH", "/servers/2001", { body: sampleServer });
    fx.on("GET", "/transactions", { body: { data: [], next_cursor: null } });
    await client.servers.update(2001, { auto_renew: false, notes: "x" });
    await client.balance.transactions({ since: new Date("2026-09-01T00:00:00Z"), direction: "debit", limit: 10, until: undefined });
    const patch = fx.requests[0]!;
    expect(patch.headers["content-type"]).toBe("application/json");
    expect(patch.json).toEqual({ auto_renew: false, notes: "x" });
    const list = fx.requests[1]!;
    expect(list.query.get("since")).toBe("2026-09-01T00:00:00.000Z");
    expect(list.query.get("direction")).toBe("debit");
    expect(list.query.get("limit")).toBe("10");
    expect(list.query.has("until")).toBe(false);
  });
});

describe("response metadata", () => {
  it("exposes request id, rate limits and sandbox flag on results, hidden from JSON", async () => {
    fx.on("GET", "/balance", {
      headers: { "X-Sandbox": "true", "X-RateLimit-Remaining": "7" },
      body: { balance: "42.15", currency: "USD", upcoming_7d: "0.00", upcoming_30d: "0.00", low_balance: false },
    });
    const b = await client.balance.get();
    expect(b.balance).toBe("42.15");
    expect(b.$meta.requestId).toBe("req_1");
    expect(b.$meta.status).toBe(200);
    expect(b.$meta.sandbox).toBe(true);
    expect(b.$meta.rateLimit).toMatchObject({ limit: 120, remaining: 7, reset: 1760000000 });
    expect(b.$meta.rateLimit.resetAt).toEqual(new Date(1760000000 * 1000));
    expect(b.$meta.attempts).toBe(1);
    expect(b.$meta.idempotencyKey).toBeNull();
    expect(Object.keys(b)).not.toContain("$meta");
    expect(JSON.parse(JSON.stringify(b))).toEqual({ balance: "42.15", currency: "USD", upcoming_7d: "0.00", upcoming_30d: "0.00", low_balance: false });
    expect(getMeta(b)).toBe(b.$meta);
    expect(getMeta({})).toBeUndefined();
  });

  it("returns only metadata for 204 responses", async () => {
    fx.on("DELETE", "/ssh-keys/3", { status: 204 });
    const meta = await client.sshKeys.delete(3);
    expect(meta.status).toBe(204);
    expect(meta.requestId).toBe("req_1");
  });

  it("returns raw bytes and the filename for the invoice PDF", async () => {
    const pdf = Buffer.from("%PDF-1.4 fake");
    fx.on("GET", "/invoices/10231/pdf", {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="invoice-10231.pdf"' },
      raw: pdf,
    });
    const res = await client.invoices.pdf(10231);
    expect(fx.requests[0]!.headers.accept).toBe("application/pdf");
    expect(Buffer.from(res.data).toString()).toBe("%PDF-1.4 fake");
    expect(res.filename).toBe("invoice-10231.pdf");
    expect(res.contentType).toBe("application/pdf");
    expect(res.$meta.requestId).toBe("req_1");
  });
});

describe("error mapping", () => {
  it("maps each status to its class and keeps code, details, request id and rate limits", async () => {
    fx.on("GET", "/e400", apiError(400, "validation_error", "months must be one of 1, 3, 6, 12", { fields: { months: "invalid_period" } }));
    fx.on("GET", "/e401", apiError(401, "key_expired"));
    fx.on("GET", "/e402", apiError(402, "insufficient_funds", "low", { required: "5.90", balance: "4.10", shortfall: "1.80", currency: "USD" }));
    fx.on("GET", "/e403", apiError(403, "insufficient_scope", "lacks", { required: ["servers:delete"] }));
    fx.on("GET", "/e404", apiError(404, "not_found"));
    fx.on("GET", "/e409", apiError(409, "domain_taken"));
    fx.on("GET", "/e413", apiError(413, "payload_too_large"));
    fx.on("GET", "/e500", apiError(500, "server_error"));

    const e400 = await client.request({ method: "GET", path: "/e400" }).catch((e) => e);
    expect(e400).toBeInstanceOf(BadRequestError);
    expect(e400.code).toBe("validation_error");
    expect(e400.fields).toEqual({ months: "invalid_period" });
    expect(e400.requestId).toBe("req_1"); // the X-Request-ID header wins over the body
    expect(e400.rateLimit.limit).toBe(120);
    expect(String(e400)).toBe("BadRequestError: [400 validation_error] months must be one of 1, 3, 6, 12 request_id=req_1");

    const e401 = await client.request({ method: "GET", path: "/e401" }).catch((e) => e);
    expect(e401).toBeInstanceOf(AuthenticationError);
    expect(e401.code).toBe("key_expired");

    const e402 = await client.request({ method: "GET", path: "/e402" }).catch((e) => e);
    expect(e402).toBeInstanceOf(InsufficientFundsError);
    expect([e402.required, e402.balance, e402.shortfall, e402.currency]).toEqual(["5.90", "4.10", "1.80", "USD"]);

    const e403 = await client.request({ method: "GET", path: "/e403" }).catch((e) => e);
    expect(e403).toBeInstanceOf(PermissionError);
    expect(e403.requiredScopes).toEqual(["servers:delete"]);

    expect(await client.request({ method: "GET", path: "/e404" }).catch((e) => e)).toBeInstanceOf(NotFoundError);
    const e409 = await client.request({ method: "GET", path: "/e409" }).catch((e) => e);
    expect(e409).toBeInstanceOf(ConflictError);
    expect(e409.code).toBe("domain_taken");

    const e413 = await client.request({ method: "GET", path: "/e413" }).catch((e) => e);
    expect(e413).toBeInstanceOf(ApiError);
    expect(e413.constructor).toBe(ApiError);
    expect(e413.status).toBe(413);

    const e500 = await client.request({ method: "GET", path: "/e500", maxRetries: 0 }).catch((e) => e);
    expect(e500).toBeInstanceOf(ServerError);
    expect(e500).toBeInstanceOf(ApiError);
    expect(e500).toBeInstanceOf(VdsokError);
    expect(e500).toBeInstanceOf(Error);
  });

  it("falls back to the body's request_id when the header is missing", async () => {
    const reply = apiError(404, "not_found", "Server 2001 not found");
    reply.headers = { "X-Request-ID": "" };
    fx.on("GET", "/servers/2001", reply);
    const err = await client.servers.get(2001).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.requestId).toBe("req_not_found");
  });

  it("copes with non-JSON error pages (nginx 502) and never leaks the key", async () => {
    fx.on("GET", "/servers/1", { status: 502, raw: "<html><body>502 Bad Gateway</body></html>", headers: { "Content-Type": "text/html" } });
    const c = new Vdsok(TEST_KEY, { baseUrl: fx.baseUrl, maxRetries: 0 });
    const err = await c.servers.get(1).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.code).toBe("upstream_error");
    expect(err.message).toContain("502 Bad Gateway");
    expect(err.body).toContain("<html>");
    const dump = JSON.stringify({ msg: err.message, str: String(err), stack: err.stack, meta: err.meta.headers });
    expect(dump).not.toContain(TEST_KEY);
  });

  it("throws TimeoutError when an attempt exceeds `timeout`", async () => {
    fx.on("GET", "/slow", { hang: true });
    const c = new Vdsok(TEST_KEY, { baseUrl: fx.baseUrl, timeout: 150, maxRetries: 0 });
    const err = await c.request({ method: "GET", path: "/slow" }).catch((e) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err.message).toMatch(/timed out after 150 ms/);
  });

  it("throws ConnectionError when nothing listens", async () => {
    const port = fx.port;
    await fx.stop();
    const c = new Vdsok(TEST_KEY, { baseUrl: `http://127.0.0.1:${port}/api/v1`, maxRetries: 0 });
    const err = await c.health().catch((e) => e);
    expect(err).toBeInstanceOf(ConnectionError);
    expect(err).not.toBeInstanceOf(TimeoutError);
    expect(err.requestId).toBeNull();
  });

  it("honours an outer AbortSignal", async () => {
    fx.on("GET", "/slow", { hang: true });
    const ac = new AbortController();
    const p = client.request({ method: "GET", path: "/slow", signal: ac.signal });
    setTimeout(() => ac.abort(new Error("user cancelled")), 50);
    await expect(p).rejects.toThrow("user cancelled");
  });
});

describe("retries", () => {
  it("retries GET on 429 after Retry-After and reports the attempts", async () => {
    fx.on("GET", "/balance", (_req, hit) =>
      hit === 1 ? apiError(429, "rate_limited", "Too many", { bucket: "normal" }, { "Retry-After": "1" }) : { body: { balance: "1.00" } },
    );
    const started = Date.now();
    const b = await client.balance.get();
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(b.balance).toBe("1.00");
    expect(b.$meta.attempts).toBe(2);
    expect(fx.hits("GET", "/balance")).toBe(2);
    const ids = fx.requests.map((r) => r.headers["x-request-id"]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("retries 502/503/504 with backoff and gives up after maxRetries", async () => {
    fx.on("GET", "/health", apiError(503, "upstream_unavailable"));
    const err = await client.health().catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(err.meta.attempts).toBe(3);
    expect(fx.hits("GET", "/health")).toBe(3);
  });

  it("surfaces RateLimitError with retryAfter when retries are exhausted", async () => {
    fx.on("GET", "/health", apiError(429, "rate_limited", "Too many requests", { bucket: "expensive", limit: 20 }, { "Retry-After": "1" }));
    const c = new Vdsok(TEST_KEY, { baseUrl: fx.baseUrl, maxRetries: 0 });
    const err = await c.health().catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(1);
    expect(err.details).toEqual({ bucket: "expensive", limit: 20 });
    expect(fx.hits("GET", "/health")).toBe(1);
  });

  it("does not wait when Retry-After exceeds maxRetryDelay", async () => {
    fx.on("GET", "/health", apiError(429, "rate_limited", "x", undefined, { "Retry-After": "120" }));
    const started = Date.now();
    const err = await client.health().catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(Date.now() - started).toBeLessThan(500);
    expect(fx.hits("GET", "/health")).toBe(1);
  });

  it("retries GET on connection failures", async () => {
    let attempts = 0;
    const flaky: typeof fetch = async (input, init) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("fetch failed");
      return fetch(input, init);
    };
    fx.on("GET", "/health", { body: { status: "ok" } });
    const c = new Vdsok(TEST_KEY, { baseUrl: fx.baseUrl, fetch: flaky });
    const h = await c.health();
    expect(h.$meta.attempts).toBe(2);
  });

  it("never retries a plain POST (no Idempotency-Key)", async () => {
    fx.on("POST", "/servers/2001/actions/power", apiError(503, "upstream_unavailable"));
    const err = await client.servers.actions.restart(2001).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableError);
    expect(fx.hits("POST", "/servers/2001/actions/power")).toBe(1);
    expect(fx.requests[0]!.headers["idempotency-key"]).toBeUndefined();
    expect(fx.requests[0]!.json).toEqual({ action: "restart" });
  });

  it("does not retry a plain POST on network errors either", async () => {
    let attempts = 0;
    const flaky: typeof fetch = async () => {
      attempts += 1;
      throw new TypeError("fetch failed");
    };
    const c = new Vdsok(TEST_KEY, { baseUrl: fx.baseUrl, fetch: flaky });
    await expect(c.servers.actions.stop(1)).rejects.toBeInstanceOf(ConnectionError);
    expect(attempts).toBe(1);
  });
});

describe("idempotency", () => {
  it("generates a uuid Idempotency-Key on money endpoints, reuses it across retries and exposes it", async () => {
    fx.on("POST", "/servers", (_req, hit) =>
      hit === 1
        ? apiError(503, "temporarily_unavailable")
        : { status: 201, body: { server: sampleServer, root_password: "secret", invoice_id: 10231, charged: "5.90", currency: "USD", balance_after: "1.00" } },
    );
    const res = await client.servers.create({ tariff_id: 12, os: "ubuntu-24.04", months: 1 });
    expect("server" in res && res.server.id).toBe(2001);
    expect(fx.hits("POST", "/servers")).toBe(2);
    const keys = fx.requests.map((r) => r.headers["idempotency-key"]);
    expect(keys[0]).toMatch(UUID_RE);
    expect(keys[0]).toBe(keys[1]);
    expect(res.$meta.idempotencyKey).toBe(keys[0]);
    expect(res.$meta.attempts).toBe(2);
    expect(fx.requests[0]!.json).toEqual({ tariff_id: 12, os: "ubuntu-24.04", months: 1 });
  });

  it("passes an explicit key through unchanged", async () => {
    fx.on("POST", "/invoices/10231/pay", { body: { invoice_id: 10231, status: "paid", balance_after: "1.00", currency: "USD" } });
    const r = await client.invoices.pay(10231, { idempotencyKey: "order-42-attempt-1" });
    expect(fx.requests[0]!.headers["idempotency-key"]).toBe("order-42-attempt-1");
    expect(r.$meta.idempotencyKey).toBe("order-42-attempt-1");
  });

  it("adds the key on every x-idempotent operation and on no other", async () => {
    const money: Array<[string, string, () => Promise<unknown>]> = [
      ["POST", "/balance/topup", () => client.balance.topup({ amount: "25.00", gateway: "cryptobot" })],
      ["POST", "/invoices/1/pay", () => client.invoices.pay(1)],
      ["POST", "/servers", () => client.servers.create({ tariff_id: 1, os: "x" })],
      ["DELETE", "/servers/1", () => client.servers.delete(1)],
      ["POST", "/servers/1/renew", () => client.servers.renew(1, { months: 3 })],
      ["POST", "/servers/1/ips", () => client.servers.ips.add(1)],
      ["POST", "/domains", () => client.domains.register({ name: "example.com" })],
      ["POST", "/domains/1/renew", () => client.domains.renew(1, 1)],
      ["POST", "/domains/transfers", () => client.domains.transfer({ name: "example.org", auth_code: "abc" })],
    ];
    const plain: Array<[string, string, () => Promise<unknown>]> = [
      ["POST", "/invoices/1/payment-link", () => client.invoices.paymentLink(1)],
      ["PATCH", "/servers/1", () => client.servers.update(1, { name: "n" })],
      ["POST", "/servers/1/actions/reinstall", () => client.servers.actions.reinstall(1, { os: "debian-12" })],
      ["POST", "/servers/1/actions/reset-password", () => client.servers.actions.resetPassword(1)],
      ["DELETE", "/servers/1/ips/5", () => client.servers.ips.delete(1, 5)],
      ["PUT", "/servers/1/ips/5/ptr", () => client.servers.ips.setPtr(1, 5, "mail.example.com")],
      ["POST", "/ssh-keys", () => client.sshKeys.create({ name: "k", public_key: "ssh-ed25519 AAAA" })],
      ["PATCH", "/domains/1", () => client.domains.update(1, { privacy: false })],
      ["PUT", "/domains/1/nameservers", () => client.domains.setNameservers(1, ["ns1.example.net", "ns2.example.net"])],
      ["DELETE", "/keys/3", () => client.keys.revoke(3)],
      ["POST", "/webhooks", () => client.webhooks.create({ url: "https://h.example/x", events: ["ping"] })],
      ["POST", "/webhooks/5/rotate-secret", () => client.webhooks.rotateSecret(5)],
      ["POST", "/webhooks/5/test", () => client.webhooks.test(5)],
      ["POST", "/webhooks/deliveries/9/redeliver", () => client.webhooks.redeliver(9)],
    ];
    for (const [m, p] of [...money, ...plain]) fx.on(m, p, { body: { ok: true } });
    for (const [, , call] of money) await call();
    for (const [, , call] of plain) await call();
    const sent = fx.requests.map((r) => [r.method, r.path, r.headers["idempotency-key"]] as const);
    for (let i = 0; i < money.length; i++) {
      expect(sent[i]![0]).toBe(money[i]![0]);
      expect(sent[i]![1]).toBe(money[i]![1]);
      expect(sent[i]![2]).toMatch(UUID_RE);
    }
    for (let i = 0; i < plain.length; i++) {
      const s = sent[money.length + i]!;
      expect(s[0]).toBe(plain[i]![0]);
      expect(s[1]).toBe(plain[i]![1]);
      expect(s[2]).toBeUndefined();
    }
  });

  it("keeps the key on errors so the caller can retry safely, and retries 409 idempotency_in_progress", async () => {
    fx.on("POST", "/servers/2001/renew", (_req, hit) =>
      hit === 1
        ? apiError(409, "idempotency_in_progress", "still running", undefined, { "Retry-After": "1" })
        : apiError(402, "insufficient_funds", "low", { required: "5.90", balance: "1.00", shortfall: "4.90", currency: "USD" }),
    );
    const err = await client.servers.renew(2001, { months: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(InsufficientFundsError);
    expect(err.idempotencyKey).toMatch(UUID_RE);
    expect(fx.hits("POST", "/servers/2001/renew")).toBe(2);
    expect(fx.requests[0]!.headers["idempotency-key"]).toBe(fx.requests[1]!.headers["idempotency-key"]);
  });

  it("does not retry a 409 conflict that has no Retry-After", async () => {
    fx.on("POST", "/domains", apiError(409, "domain_taken"));
    await expect(client.domains.register({ name: "taken.com" })).rejects.toBeInstanceOf(ConflictError);
    expect(fx.hits("POST", "/domains")).toBe(1);
  });
});

describe("resources", () => {
  it("routes every group to the right path and method", async () => {
    const routes: Array<[string, string, () => Promise<unknown>]> = [
      ["GET", "/health", () => client.health()],
      ["GET", "/me", () => client.me()],
      ["GET", "/account", () => client.account.get()],
      ["GET", "/balance", () => client.balance.get()],
      ["GET", "/balance/topup-info", () => client.balance.topupInfo()],
      ["GET", "/invoices/7", () => client.invoices.get(7)],
      ["GET", "/catalog/tariffs", () => client.catalog.tariffs({ location_id: 1 })],
      ["GET", "/catalog/tariffs/12", () => client.catalog.tariff(12)],
      ["GET", "/catalog/os", () => client.catalog.os({ tariff_id: 12 })],
      ["GET", "/catalog/locations", () => client.catalog.locations()],
      ["GET", "/catalog/zones", () => client.catalog.zones()],
      ["GET", "/catalog/quote", () => client.catalog.quote({ tariff_id: 12, months: 3, promo_code: "X" })],
      ["GET", "/servers/2001", () => client.servers.get(2001, { include: "live" })],
      ["GET", "/servers/2001/status", () => client.servers.status(2001)],
      ["GET", "/servers/2001/refund-quote", () => client.servers.refundQuote(2001)],
      ["GET", "/servers/2001/ips", () => client.servers.ips.list(2001)],
      ["GET", "/servers/2001/ips/quote", () => client.servers.ips.quote(2001)],
      ["GET", "/orders/10231", () => client.servers.orders.get(10231)],
      ["GET", "/ssh-keys", () => client.sshKeys.list()],
      ["GET", "/domains/availability", () => client.domains.checkAvailability("пример.рф")],
      ["GET", "/domains/77", () => client.domains.get(77)],
      ["GET", "/keys", () => client.keys.list()],
      ["GET", "/keys/3", () => client.keys.get(3)],
      ["GET", "/webhooks", () => client.webhooks.list()],
      ["GET", "/webhooks/events", () => client.webhooks.events()],
      ["GET", "/webhooks/5", () => client.webhooks.get(5)],
      ["PATCH", "/webhooks/5", () => client.webhooks.update(5, { active: true })],
      ["DELETE", "/webhooks/5", () => client.webhooks.delete(5)],
    ];
    for (const [m, p] of routes) fx.on(m, p, { body: { data: [] } });
    for (const [, , call] of routes) await call();
    expect(fx.requests.map((r) => `${r.method} ${r.path}`)).toEqual(routes.map(([m, p]) => `${m} ${p}`));
    const q = fx.requests.find((r) => r.path === "/catalog/quote")!.query;
    expect(Object.fromEntries(q)).toEqual({ tariff_id: "12", months: "3", promo_code: "X" });
    expect(fx.requests.find((r) => r.path === "/servers/2001")!.query.get("include")).toBe("live");
    expect(fx.requests.find((r) => r.path === "/domains/availability")!.query.get("name")).toBe("пример.рф");
  });

  it("setPtr sends `domain` and reads back {id, ptr}", async () => {
    // Роут принимает только `domain` (api_v1/routes/ips.py:224) и отвечает
    // двумя полями (:231): с телом {ptr} это был бы гарантированный 400.
    fx.on("PUT", "/servers/2001/ips/501/ptr", { body: { id: 501, ptr: "mail.example.com" } });
    const rec = await client.servers.ips.setPtr(2001, 501, "mail.example.com");
    expect(fx.requests[0]!.json).toEqual({ domain: "mail.example.com" });
    expect(rec.id).toBe(501);
    expect(rec.ptr).toBe("mail.example.com");
    fx.on("PUT", "/servers/2001/ips/501/ptr", { body: { id: 501, ptr: null } });
    await client.servers.ips.setPtr(2001, 501, null);
    expect(fx.requests[1]!.json).toEqual({ domain: "" });
  });

  it("revokeSelf looks the calling key up via /me", async () => {
    // Формы ответов взяты с реального бэкенда (api_v1/routes/meta.py:me,
    // routes/keys.py:keys_revoke_self): /me отдаёт ключ в поле `key`,
    // DELETE /keys/{id} — конверт {status, key}.
    fx.on("GET", "/me", { body: { account_id: 1, key: { id: 9, active: true } } });
    fx.on("DELETE", "/keys/9", { body: { status: "revoked", key: { id: 9, active: false } } });
    const k = await client.keys.revokeSelf();
    expect(k.status).toBe("revoked");
    expect(k.key.active).toBe(false);
    expect(fx.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /me", "DELETE /keys/9"]);
  });

  it("reads the envelopes the /v1 backend actually returns for webhooks", async () => {
    // Формы ниже скопированы с api_v1/routes/webhooks.py: rotate-secret отдаёт
    // только {id, secret}, DELETE — 200 с {status, id}, test — запись журнала
    // плюс исход попытки, redeliver — 202 {status, delivery}. Если бэкенд
    // изменит конверт, этот тест падает раньше пользователей.
    const delivery = {
      id: 77,
      subscription_id: 5,
      event_id: "evt_abc123",
      event_type: "ping",
      attempts: 1,
      next_attempt_at: null,
      delivered_at: "2026-09-15T10:00:01Z",
      dead: false,
      last_status: 200,
      last_error: null,
      last_response: "ok",
      created_at: "2026-09-15T10:00:00Z",
    };
    fx.on("POST", "/webhooks/5/rotate-secret", { body: { id: 5, secret: "whsec_rotated" } });
    fx.on("DELETE", "/webhooks/5", { body: { status: "deleted", id: 5 } });
    fx.on("POST", "/webhooks/5/test", { body: { delivery, ok: true, status: 200, latency_ms: 42, detail: null } });
    fx.on("POST", "/webhooks/deliveries/77/redeliver", { status: 202, body: { status: "queued", delivery } });

    const rotated = await client.webhooks.rotateSecret(5);
    expect(rotated.id).toBe(5);
    expect(rotated.secret).toBe("whsec_rotated");

    const ping = await client.webhooks.test(5);
    expect(ping.ok).toBe(true);
    expect(ping.status).toBe(200);
    expect(ping.latency_ms).toBe(42);
    expect(ping.delivery.dead).toBe(false);

    const queued = await client.webhooks.redeliver(77);
    expect(queued.status).toBe("queued");
    expect(queued.delivery.id).toBe(77);
    expect(queued.$meta.status).toBe(202);

    const removed = await client.webhooks.delete(5);
    expect(removed).toEqual({ status: "deleted", id: 5 });
  });

  it("orders.wait polls until a terminal state", async () => {
    fx.on("GET", "/orders/10231", (_req, hit) => ({
      body: { invoice_id: 10231, status: hit < 3 ? "provisioning" : "active", server_id: hit < 3 ? null : 2002 },
    }));
    const order = await client.servers.orders.wait(10231, { intervalMs: 20 });
    expect(order.status).toBe("active");
    expect(order.server_id).toBe(2002);
    expect(fx.hits("GET", "/orders/10231")).toBe(3);
  });

  it("orders.wait gives up on its own deadline", async () => {
    // Отдельный маршрут, который НИКОГДА не выходит из provisioning: иначе
    // ветка таймаута не выполняется и тест зеленеет по другой причине.
    fx.on("GET", "/orders/10232", { body: { invoice_id: 10232, status: "provisioning", server_id: null } });
    await expect(client.servers.orders.wait(10232, { intervalMs: 10, timeoutMs: 40 })).rejects.toThrow(
      /still provisioning after 40 ms/,
    );
    expect(fx.hits("GET", "/orders/10232")).toBeGreaterThanOrEqual(1);
  });

  it("orders.wait stops polling and unsubscribes when the signal aborts", async () => {
    fx.on("GET", "/orders/10233", { body: { invoice_id: 10233, status: "provisioning", server_id: null } });
    const ac = new AbortController();
    // Слушатель abort должен сниматься после каждого ожидания — иначе Node
    // ругается MaxListenersExceededWarning на десятке опросов.
    const p = client.servers.orders.wait(10233, { intervalMs: 5, timeoutMs: 10_000, signal: ac.signal });
    setTimeout(() => ac.abort(new Error("cancelled by user")), 120);
    await expect(p).rejects.toThrow("cancelled by user");
    expect(getEventListeners(ac.signal, "abort").length).toBeLessThan(5);
  });
});
