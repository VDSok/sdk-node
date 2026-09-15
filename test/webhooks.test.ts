import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Vdsok, Webhooks, WebhookSignatureError, constructEvent, sign, verify } from "../src/index.js";
import type { WebhookEventServer } from "../src/index.js";

const secret = "whsec_test_example_secret";
const event = {
  id: "evt_01J7ZK3Q9X4R",
  type: "server.suspended",
  created_at: "2026-09-15T10:00:00Z",
  livemode: true,
  account_id: 57,
  api_version: "1",
  data: { object: { id: 2001, name: "web-01", status: "suspended" }, previous: { status: "active" } },
  resource: "/api/v1/servers/2001",
};
const body = JSON.stringify(event);

function headersFor(ts: number | string, sig?: string): Record<string, string> {
  return {
    "X-Webhook-Signature": sig ?? `v1=${sign(secret, ts, body)}`,
    "X-Webhook-Timestamp": String(ts),
    "X-Webhook-Id": event.id,
    "X-Webhook-Event": event.type,
    "User-Agent": "VDSok-Webhooks/1.0",
  };
}

const now = () => Math.floor(Date.now() / 1000);

describe("sign", () => {
  it("is hex HMAC-SHA256 over `{timestamp}.{body}`", () => {
    const expected = createHmac("sha256", secret).update(`1700000000.${body}`).digest("hex");
    expect(sign(secret, 1700000000, body)).toBe(expected);
    expect(sign(secret, "1700000000", Buffer.from(body))).toBe(expected);
    expect(sign(secret, 1700000000, new TextEncoder().encode(body).buffer)).toBe(expected);
  });
});

describe("verify", () => {
  it("accepts a valid delivery and returns the header values", () => {
    const ts = now();
    const v = verify(secret, headersFor(ts), body);
    expect(v).toEqual({ id: event.id, event: event.type, timestamp: ts, signature: sign(secret, ts, body) });
  });

  it("accepts Headers instances, Node request headers (lowercase, arrays) and raw bytes", () => {
    const ts = now();
    expect(() => verify(secret, new Headers(headersFor(ts)), Buffer.from(body))).not.toThrow();
    const nodeHeaders: Record<string, string | string[]> = {
      "x-webhook-signature": [`v1=${sign(secret, ts, body)}`],
      "x-webhook-timestamp": String(ts),
      host: "hooks.example.com",
    };
    const v = verify(secret, nodeHeaders, new TextEncoder().encode(body));
    expect(v.id).toBeNull();
    expect(v.timestamp).toBe(ts);
    expect(() => verify(secret, Object.entries(headersFor(ts)), body)).not.toThrow();
  });

  it("rejects a wrong secret, a tampered body and a tampered timestamp", () => {
    const ts = now();
    expect(() => verify("whsec_other", headersFor(ts), body)).toThrow(WebhookSignatureError);
    expect(() => verify(secret, headersFor(ts), body.replace("suspended", "active"))).toThrow(/mismatch/);
    const h = headersFor(ts);
    h["X-Webhook-Timestamp"] = String(ts + 1);
    expect(() => verify(secret, h, body)).toThrow(/mismatch/);
  });

  it("rejects missing or malformed headers and an empty secret", () => {
    const ts = now();
    const h = headersFor(ts);
    expect(() => verify(secret, { "X-Webhook-Timestamp": String(ts) }, body)).toThrow(/Missing X-Webhook-Signature/);
    expect(() => verify(secret, { "X-Webhook-Signature": h["X-Webhook-Signature"]! }, body)).toThrow(/Missing X-Webhook-Timestamp/);
    expect(() => verify(secret, headersFor("abc", `v1=${sign(secret, "abc", body)}`), body)).toThrow(/not a number/);
    expect(() => verify(secret, headersFor(ts, "v0=deadbeef"), body)).toThrow(/No v1=/);
    expect(() => verify(secret, headersFor(ts, "v1=zz"), body)).toThrow(/mismatch/);
    expect(() => verify("", headersFor(ts), body)).toThrow(/secret is empty/);
  });

  it("enforces the timestamp tolerance (default 300 s) and lets 0 disable it", () => {
    const old = now() - 301;
    expect(() => verify(secret, headersFor(old), body)).toThrow(/tolerance/);
    expect(() => verify(secret, headersFor(old), body, 600)).not.toThrow();
    expect(() => verify(secret, headersFor(old), body, 0)).not.toThrow();
    const future = now() + 400;
    expect(() => verify(secret, headersFor(future), body)).toThrow(/tolerance/);
    expect(() => verify(secret, headersFor(now() - 200), body)).not.toThrow();
  });

  it("accepts any matching candidate in a comma-separated signature header", () => {
    const ts = now();
    const good = sign(secret, ts, body);
    const v = verify(secret, headersFor(ts, `v1=${"0".repeat(64)}, v1=${good}`), body);
    expect(v.signature).toBe(good);
  });
});

describe("constructEvent", () => {
  it("verifies and parses the envelope, typed by the caller", () => {
    const ts = now();
    const ev = constructEvent<WebhookEventServer>(secret, headersFor(ts), body);
    expect(ev.type).toBe("server.suspended");
    expect(ev.data.object.id).toBe(2001);
    expect(ev.data.previous).toEqual({ status: "active" });
  });

  it("rejects invalid signatures before parsing, and bodies that are not an envelope", () => {
    const ts = now();
    expect(() => constructEvent("whsec_other", headersFor(ts), body)).toThrow(WebhookSignatureError);
    const notJson = "{not json";
    expect(() => constructEvent(secret, headersFor(ts, `v1=${sign(secret, ts, notJson)}`), notJson)).toThrow(/not valid JSON/);
    const noType = JSON.stringify({ id: "evt_1" });
    expect(() => constructEvent(secret, headersFor(ts, `v1=${sign(secret, ts, noType)}`), noType)).toThrow(/not an event envelope/);
  });

  it("is reachable as Webhooks.* and client.webhooks.*", () => {
    const ts = now();
    expect(Webhooks.verify).toBe(verify);
    expect(Webhooks.constructEvent).toBe(constructEvent);
    expect(Webhooks.DEFAULT_TOLERANCE_SECONDS).toBe(300);
    const client = new Vdsok("vk_test_example", { baseUrl: "http://127.0.0.1:9/api/v1" });
    expect(client.webhooks.verify(secret, headersFor(ts), body).id).toBe(event.id);
    expect(client.webhooks.constructEvent(secret, headersFor(ts), body).type).toBe("server.suspended");
    expect(client.webhooks.sign).toBe(sign);
  });
});
