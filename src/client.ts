import { randomUUID } from "node:crypto";
import { buildApiError, ConnectionError, TimeoutError, VdsokError, type ApiError } from "./errors.js";
import { attachMeta, buildMeta, type ResponseMeta, type WithMeta } from "./meta.js";
import { Page } from "./pagination.js";
import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, USER_AGENT } from "./version.js";

/** Options accepted by the `Vdsok` constructor. */
export interface ClientOptions {
  /** API root; defaults to `https://vdsok.guru/api/v1`. */
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds (default 30 000). */
  timeout?: number;
  /** How many times a failed attempt is repeated (default 2, i.e. up to 3 attempts). */
  maxRetries?: number;
  /** Longest wait the SDK accepts from `Retry-After` before giving up (default 30 000 ms). */
  maxRetryDelay?: number;
  /** Custom `fetch` (tests, proxies, polyfills). Defaults to the global one. */
  fetch?: typeof fetch;
  /** Extra headers sent with every request (cannot override `Authorization`). */
  headers?: Record<string, string>;
}

/** Per-call overrides. */
export interface RequestOptions {
  /** Explicit `Idempotency-Key` for money endpoints; generated when omitted. */
  idempotencyKey?: string;
  timeout?: number;
  maxRetries?: number;
  /** Abort the whole call (all attempts) from the outside. */
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export type QueryValue = string | number | boolean | Date | null | undefined;
export type Query = Record<string, QueryValue | QueryValue[]>;

export interface RequestSpec extends RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path relative to `baseUrl`, e.g. `/servers/2001`. */
  path: string;
  query?: Query;
  body?: unknown;
  /** The operation is `x-idempotent`: an `Idempotency-Key` is required and retries are safe. */
  idempotent?: boolean;
  /** Ask for a non-JSON body (PDF); the raw bytes come back in `data`. */
  accept?: string;
}

export interface RawResponse<T = unknown> {
  data: T;
  meta: ResponseMeta;
}

// Только на этих статусах повтор имеет смысл: лимит, сбой/таймаут панели или
// сам API временно выключен. 4xx-ошибки валидации/денег повторять бессмысленно.
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 8_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(abortError(signal));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new ConnectionError("Request aborted");
}

/**
 * Убирает любое написание Authorization из пользовательских заголовков:
 * ключ ставит только сам транспорт.
 */
function stripAuth(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== "authorization"));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Object.prototype.toString.call(v) === "[object Object]";
}

/** Serializes query values; arrays repeat the key, dates become RFC 3339, nullish keys are skipped. */
export function buildQuery(query: Query | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (v === undefined || v === null) continue;
      params.append(key, v instanceof Date ? v.toISOString() : String(v));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : "";
}

/**
 * HTTP transport shared by all resource groups: auth, headers, timeouts,
 * retries, idempotency keys, error mapping and `$meta` attachment.
 * Resource classes call `request()`; end users normally never need it.
 */
export class Transport {
  readonly baseUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;
  readonly maxRetryDelay: number;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #headers: Record<string, string>;

  constructor(apiKey: string, options: ClientOptions = {}) {
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      throw new VdsokError("VDSok API key is required (a vk_live_… or vk_test_… string)");
    }
    this.#apiKey = apiKey.trim();
    // Без завершающего слэша, чтобы path всегда начинался с "/" и не было "//".
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxRetryDelay = options.maxRetryDelay ?? DEFAULT_MAX_RETRY_DELAY_MS;
    const f = options.fetch ?? globalThis.fetch;
    if (typeof f !== "function") {
      throw new VdsokError("Global fetch is not available; use Node 18+ or pass options.fetch");
    }
    this.#fetch = f;
    // Заголовки HTTP регистронезависимы: "AUTHORIZATION" рядом с нашим
    // Authorization дал бы в fetch один заголовок с двумя значениями через
    // запятую, поэтому фильтруем по нижнему регистру, а не по двум написаниям.
    this.#headers = stripAuth(options.headers);
  }

  /** Last 4 characters of the key for logs; the key itself is never exposed. */
  get keyHint(): string {
    const k = this.#apiKey;
    const prefix = k.startsWith("vk_test_") ? "vk_test_" : k.startsWith("vk_live_") ? "vk_live_" : "";
    return `${prefix}…${k.slice(-4)}`;
  }

  /** Whether the configured key is a `vk_test_` (sandbox) key. */
  get isTestKey(): boolean {
    return this.#apiKey.startsWith("vk_test_");
  }

  /** Performs a request and returns the parsed body plus response metadata. */
  async request<T = unknown>(spec: RequestSpec): Promise<RawResponse<T>> {
    const url = this.baseUrl + spec.path + buildQuery(spec.query);
    const timeout = spec.timeout ?? this.timeout;
    const maxRetries = Math.max(0, spec.maxRetries ?? this.maxRetries);

    // Денежные ручки: ключ генерируем один раз на логический запрос и
    // используем во всех повторах — так сервер вернёт сохранённый ответ,
    // а не спишет деньги второй раз.
    const idempotencyKey = spec.idempotent ? (spec.idempotencyKey ?? randomUUID()) : (spec.idempotencyKey ?? null);
    const canRetry = spec.method === "GET" || idempotencyKey != null;

    const bodyText = spec.body === undefined ? undefined : JSON.stringify(spec.body);

    let attempt = 0;
    for (;;) {
      attempt += 1;
      const clientRequestId = randomUUID();
      const headers: Record<string, string> = {
        ...this.#headers,
        ...stripAuth(spec.headers),
        Authorization: `Bearer ${this.#apiKey}`,
        Accept: spec.accept ?? "application/json",
        "User-Agent": USER_AGENT,
        "X-Request-ID": clientRequestId,
      };
      if (bodyText !== undefined) headers["Content-Type"] = "application/json";
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

      let response: Response;
      try {
        response = await this.#send(url, spec.method, headers, bodyText, timeout, spec.signal);
      } catch (err) {
        if (spec.signal?.aborted) throw err;
        if (canRetry && attempt <= maxRetries) {
          await sleep(this.#backoff(attempt), spec.signal);
          continue;
        }
        throw err;
      }

      const meta = buildMeta(response.headers, response.status, clientRequestId, idempotencyKey, attempt);

      if (response.ok) {
        const data = (await this.#parseBody(response, spec.accept)) as T;
        return { data, meta };
      }

      const errBody = await this.#parseBody(response, "application/json");
      const error = buildApiError(response.status, errBody, meta);

      if (canRetry && attempt <= maxRetries && this.#shouldRetry(error)) {
        const delay = this.#delayFor(error, attempt);
        if (delay !== null) {
          await sleep(delay, spec.signal);
          continue;
        }
      }
      throw error;
    }
  }

  /** `request()` for a JSON object; the result carries `$meta`. */
  async json<T extends object>(spec: RequestSpec): Promise<WithMeta<T>> {
    const { data, meta } = await this.request<T>(spec);
    const value = isPlainObject(data) || Array.isArray(data) ? data : ({} as T);
    return attachMeta(value as T, meta);
  }

  /** A request that yields no body (`204`); only metadata comes back. */
  async empty(spec: RequestSpec): Promise<ResponseMeta> {
    const { meta } = await this.request(spec);
    return meta;
  }

  /** A cursor-paginated list; the returned `Page` knows how to fetch the rest. */
  async page<T>(spec: RequestSpec): Promise<Page<T>> {
    const { data, meta } = await this.request<{ data?: T[]; next_cursor?: string | null }>(spec);
    const items = Array.isArray(data?.data) ? data.data : [];
    const next = typeof data?.next_cursor === "string" ? data.next_cursor : null;
    // Следующая страница — тот же запрос с тем же набором фильтров, только
    // с курсором сервера; вручную курсоры не собирают, они подписаны.
    return new Page<T>(items, next, meta, (cursor) =>
      this.page<T>({ ...spec, query: { ...(spec.query ?? {}), cursor } }),
    );
  }

  async #send(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    timeout: number,
    outer?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    const onOuterAbort = () => controller.abort(outer?.reason);
    if (outer) {
      if (outer.aborted) onOuterAbort();
      else outer.addEventListener("abort", onOuterAbort, { once: true });
    }
    try {
      return await this.#fetch(url, { method, headers, body, signal: controller.signal, redirect: "manual" });
    } catch (cause) {
      if (outer?.aborted) throw abortError(outer);
      if (timedOut) {
        throw new TimeoutError(`${method} ${url} timed out after ${timeout} ms`, { cause });
      }
      // fetch кидает TypeError с причиной в cause (ECONNREFUSED, ENOTFOUND…);
      // наружу отдаём свой класс, чтобы ловить одной веткой catch.
      const detail = cause instanceof Error ? (cause.cause instanceof Error ? cause.cause.message : cause.message) : String(cause);
      throw new ConnectionError(`${method} ${url} failed: ${detail}`, { cause });
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  }

  async #parseBody(response: Response, accept: string | undefined): Promise<unknown> {
    if (response.status === 204 || response.headers.get("content-length") === "0") return null;
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (accept && accept !== "application/json" && response.ok) {
      return new Uint8Array(await response.arrayBuffer());
    }
    const text = await response.text();
    if (text === "") return null;
    if (type.includes("json")) {
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    // Ответ не JSON (nginx-страница 502 и т.п.) — отдаём текст как есть,
    // buildApiError положит его начало в message.
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  #shouldRetry(error: ApiError): boolean {
    if (RETRY_STATUSES.has(error.status)) return true;
    // Первый запрос с этим ключом ещё выполняется — сервер сам просит подождать.
    return error.status === 409 && error.code === "idempotency_in_progress" && error.retryAfter != null;
  }

  #delayFor(error: ApiError, attempt: number): number | null {
    if (error.retryAfter != null) {
      const ms = error.retryAfter * 1000;
      // Сервер просит ждать дольше, чем мы готовы — лучше отдать ошибку
      // вызывающему сразу, чем висеть минуту.
      return ms > this.maxRetryDelay ? null : ms;
    }
    return this.#backoff(attempt);
  }

  #backoff(attempt: number): number {
    const base = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
    return base + Math.floor(Math.random() * 100);
  }
}
