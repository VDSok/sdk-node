import type { Health, Me } from "./api.js";
import { Transport, type ClientOptions, type RequestOptions, type RequestSpec, type RawResponse } from "./client.js";
import type { WithMeta } from "./meta.js";
import { AccountResource } from "./resources/account.js";
import { BalanceResource } from "./resources/balance.js";
import { CatalogResource } from "./resources/catalog.js";
import { DomainsResource } from "./resources/domains.js";
import { InvoicesResource } from "./resources/invoices.js";
import { KeysResource } from "./resources/keys.js";
import { ServersResource } from "./resources/servers.js";
import { SshKeysResource } from "./resources/sshKeys.js";
import { WebhooksResource } from "./resources/webhooks.js";

/**
 * VDSok Client API v1.
 *
 * ```ts
 * import { Vdsok } from "@vdsok/sdk";
 * const client = new Vdsok(process.env.VDSOK_API_KEY);
 * const balance = await client.balance.get();
 * ```
 */
export class Vdsok {
  readonly account: AccountResource;
  readonly balance: BalanceResource;
  readonly invoices: InvoicesResource;
  readonly catalog: CatalogResource;
  readonly servers: ServersResource;
  readonly domains: DomainsResource;
  readonly sshKeys: SshKeysResource;
  readonly keys: KeysResource;
  readonly webhooks: WebhooksResource;

  readonly #transport: Transport;

  /**
   * @param apiKey `vk_live_…` or `vk_test_…`; falls back to `process.env.VDSOK_API_KEY`.
   */
  constructor(apiKey?: string, options: ClientOptions = {}) {
    const key = apiKey ?? (typeof process !== "undefined" ? process.env?.VDSOK_API_KEY : undefined) ?? "";
    this.#transport = new Transport(key, options);
    this.account = new AccountResource(this.#transport);
    this.balance = new BalanceResource(this.#transport);
    this.invoices = new InvoicesResource(this.#transport);
    this.catalog = new CatalogResource(this.#transport);
    this.servers = new ServersResource(this.#transport);
    this.domains = new DomainsResource(this.#transport);
    this.sshKeys = new SshKeysResource(this.#transport);
    this.keys = new KeysResource(this.#transport);
    this.webhooks = new WebhooksResource(this.#transport);
  }

  get baseUrl(): string {
    return this.#transport.baseUrl;
  }

  /** `vk_test_…` keys read real data and simulate every write. */
  get isTestKey(): boolean {
    return this.#transport.isTestKey;
  }

  /** Prefix + last 4 characters of the key, safe for logs. */
  get keyHint(): string {
    return this.#transport.keyHint;
  }

  /** Liveness and API switch state; no key needed by the server, but sent anyway. */
  health(options?: RequestOptions): Promise<WithMeta<Health>> {
    return this.#transport.json<Health>({ method: "GET", path: "/health", ...options });
  }

  /** Who am I — the calling key, its scopes and `livemode`. Cheapest way to validate a key. */
  me(options?: RequestOptions): Promise<WithMeta<Me>> {
    return this.#transport.json<Me>({ method: "GET", path: "/me", ...options });
  }

  /** Escape hatch: any endpoint with the SDK's auth, retries and error mapping. */
  request<T = unknown>(spec: RequestSpec): Promise<RawResponse<T>> {
    return this.#transport.request<T>(spec);
  }
}

/** Alias for readers who prefer the longer name. */
export { Vdsok as VdsokClient };

export { Transport, buildQuery } from "./client.js";
export type { ClientOptions, RequestOptions, RequestSpec, RawResponse, Query, QueryValue } from "./client.js";
export { Page } from "./pagination.js";
export { attachMeta, getMeta, parseRetryAfter } from "./meta.js";
export { parseTimestamp, formatTimestamp } from "./parsing.js";
export type { ResponseMeta, RateLimitInfo, WithMeta } from "./meta.js";
export {
  VdsokError,
  ApiError,
  BadRequestError,
  AuthenticationError,
  InsufficientFundsError,
  PermissionError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ServerError,
  UpstreamError,
  ServiceUnavailableError,
  ConnectionError,
  TimeoutError,
  WebhookSignatureError,
  errorClassFor,
  buildApiError,
} from "./errors.js";
export { Webhooks, verify, constructEvent, sign, DEFAULT_TOLERANCE_SECONDS } from "./webhooks.js";
export type { HeaderLike, VerifiedWebhookHeaders } from "./webhooks.js";
export { VERSION, USER_AGENT, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_RETRIES } from "./version.js";

export { AccountResource } from "./resources/account.js";
export { BalanceResource } from "./resources/balance.js";
export type { TransactionListParams } from "./resources/balance.js";
export { InvoicesResource } from "./resources/invoices.js";
export type { InvoiceListParams, InvoicePdf } from "./resources/invoices.js";
export { CatalogResource } from "./resources/catalog.js";
export type { TariffListParams, OsListParams, QuoteParams, ListResult } from "./resources/catalog.js";
export { ServersResource, ServerActionsResource, ServerIpsResource, OrdersResource } from "./resources/servers.js";
export type { ServerListParams, ServerGetParams, OrderListParams } from "./resources/servers.js";
export { DomainsResource } from "./resources/domains.js";
export type { DomainListParams } from "./resources/domains.js";
export { SshKeysResource } from "./resources/sshKeys.js";
export { KeysResource } from "./resources/keys.js";
export { WebhooksResource } from "./resources/webhooks.js";
export type { WebhookDeliveryListParams } from "./resources/webhooks.js";

export type * from "./api.js";
export type { paths, components, operations } from "./types.js";
