import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from "node:http";

/**
 * Минимальный HTTP-стенд на node:http: маршруты регистрируются в тесте,
 * каждый запрос записывается вместе с заголовками и телом, чтобы проверять,
 * что именно ушло по сети (Authorization, Idempotency-Key, X-Request-ID…).
 * Никаких моков fetch — SDK гоняется через настоящий сокет.
 */
export interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: string;
  json: unknown;
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  /** JSON-serialised unless `raw` is set. */
  body?: unknown;
  raw?: Buffer | string;
  /** Delay before answering, ms. */
  delay?: number;
  /** Never answer (for timeout tests). */
  hang?: boolean;
}

export type Handler = (req: Recorded, hit: number) => Reply | Promise<Reply>;

export function apiError(
  status: number,
  code: string,
  message = code,
  details?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Reply {
  return {
    status,
    headers,
    body: { error: { code, message, request_id: `req_${code}`, details } },
  };
}

export class FixtureServer {
  readonly requests: Recorded[] = [];
  #server: Server | null = null;
  #routes = new Map<string, { handler: Handler; hits: number }>();
  #counter = 0;
  baseUrl = "";

  /** Registers a handler for `METHOD /path` (path without the /api/v1 prefix). */
  on(method: string, path: string, handler: Handler | Reply): this {
    const h: Handler = typeof handler === "function" ? handler : () => handler;
    this.#routes.set(`${method.toUpperCase()} ${path}`, { handler: h, hits: 0 });
    return this;
  }

  hits(method: string, path: string): number {
    return this.#routes.get(`${method.toUpperCase()} ${path}`)?.hits ?? 0;
  }

  async start(): Promise<string> {
    this.#server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => void this.#dispatch(req.method ?? "GET", req.url ?? "/", req.headers, Buffer.concat(chunks), res));
    });
    await new Promise<void>((resolve) => this.#server!.listen(0, "127.0.0.1", resolve));
    const addr = this.#server.address();
    if (!addr || typeof addr === "string") throw new Error("no address");
    this.baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
    return this.baseUrl;
  }

  /** Port the server listened on (usable after `stop()` for "connection refused" tests). */
  get port(): number {
    return Number(new URL(this.baseUrl).port);
  }

  async stop(): Promise<void> {
    const s = this.#server;
    if (!s) return;
    this.#server = null;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  async #dispatch(method: string, rawUrl: string, headers: IncomingHttpHeaders, body: Buffer, res: ServerResponse): Promise<void> {
    const url = new URL(rawUrl, "http://localhost");
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const text = body.toString("utf8");
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const rec: Recorded = { method, path, query: url.searchParams, headers, body: text, json };
    this.requests.push(rec);

    const route = this.#routes.get(`${method} ${path}`);
    this.#counter += 1;
    const std: Record<string, string> = {
      "X-Request-ID": `req_${this.#counter}`,
      "X-RateLimit-Limit": "120",
      "X-RateLimit-Remaining": String(120 - this.#counter),
      "X-RateLimit-Reset": "1760000000",
    };
    if (!route) {
      res.writeHead(404, { ...std, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "not_found", message: `No route ${method} ${path}`, request_id: std["X-Request-ID"] } }));
      return;
    }
    route.hits += 1;
    const reply = await route.handler(rec, route.hits);
    if (reply.hang) return; // closed by closeAllConnections()
    if (reply.delay) await new Promise((r) => setTimeout(r, reply.delay));
    const status = reply.status ?? 200;
    const hdrs: Record<string, string> = { ...std, ...(reply.headers ?? {}) };
    if (reply.raw !== undefined) {
      res.writeHead(status, hdrs);
      res.end(reply.raw);
      return;
    }
    if (status === 204 || reply.body === undefined) {
      res.writeHead(status, hdrs);
      res.end();
      return;
    }
    res.writeHead(status, { "Content-Type": "application/json", ...hdrs });
    res.end(JSON.stringify(reply.body));
  }
}

/** Short placeholder key; never a real-looking one (the export script rejects those). */
export const TEST_KEY = "vk_test_example";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const sampleServer = {
  id: 2001,
  name: "web-01",
  hostname: null,
  status: "active",
  tariff: { id: 12, name: "VDS-1" },
  location: { id: 1, code: "nl-ams", name: "Amsterdam", country: "NL", city: "Amsterdam" },
  os: { slug: "ubuntu-24.04", name: "Ubuntu 24.04" },
  // Адрес из TEST-NET-1 (RFC 5737): sdk_export.py отказывается копировать
  // файлы с реальными адресами прода.
  ip: "192.0.2.10",
  ips: ["192.0.2.10"],
  resources: { cpu_cores: 1, ram_mb: 1024, disk_gb: 20, bandwidth_tb: null, port_mbps: 200 },
  flags: { blocked: false, suspended: false, expired: false, pending_cancel: false, protected_until: null, is_test: false },
  billing: {
    cycle: "monthly",
    months: 1,
    price_monthly: "5.90",
    price_hourly: null,
    recurring_amount: "5.90",
    currency: "USD",
    next_due_at: "2026-10-01T00:00:00Z",
    auto_renew: true,
    promo_code: null,
    extra_ips: 0,
  },
  notes: null,
  created_at: "2026-03-01T12:00:00Z",
  cancelled_at: null,
};
