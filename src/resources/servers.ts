import type {
  ActionResult,
  DeleteResult,
  Ip,
  IpAdded,
  IpDeleted,
  IpQuote,
  Order,
  PowerAction,
  PtrRecord,
  PtrUpdate,
  QueryOf,
  RefundQuote,
  ReinstallRequest,
  ReinstallResult,
  RenewRequest,
  RenewResult,
  ResetPasswordResult,
  Server,
  ServerCreate,
  ServerCreated,
  ServerDetail,
  ServerLiveStatus,
  ServerUpdate,
} from "../api.js";
import type { RequestOptions, Transport } from "../client.js";
import type { WithMeta } from "../meta.js";
import type { Page } from "../pagination.js";
import type { ListResult } from "./catalog.js";

export type ServerListParams = QueryOf<"list_servers">;
export type ServerGetParams = QueryOf<"get_server">;
export type OrderListParams = QueryOf<"list_orders">;

/** `POST /servers/{id}/actions/*` — power, reinstall, root password. */
export class ServerActionsResource {
  constructor(private readonly t: Transport) {}

  /** Start, stop or restart (`servers:manage`). Not retried automatically. */
  power(serverId: number, action: PowerAction, options?: RequestOptions): Promise<WithMeta<ActionResult>> {
    return this.t.json<ActionResult>({
      method: "POST",
      path: `/servers/${serverId}/actions/power`,
      body: { action },
      ...options,
    });
  }

  start(serverId: number, options?: RequestOptions): Promise<WithMeta<ActionResult>> {
    return this.power(serverId, "start", options);
  }

  stop(serverId: number, options?: RequestOptions): Promise<WithMeta<ActionResult>> {
    return this.power(serverId, "stop", options);
  }

  restart(serverId: number, options?: RequestOptions): Promise<WithMeta<ActionResult>> {
    return this.power(serverId, "restart", options);
  }

  /** Reinstall the OS — destroys all data (`servers:manage`). A generated password is returned once. */
  reinstall(serverId: number, body: ReinstallRequest, options?: RequestOptions): Promise<WithMeta<ReinstallResult>> {
    return this.t.json<ReinstallResult>({ method: "POST", path: `/servers/${serverId}/actions/reinstall`, body, ...options });
  }

  /** Generate a new root password, shown once (`servers:manage`; 5 calls per 5 minutes per server). */
  resetPassword(serverId: number, options?: RequestOptions): Promise<WithMeta<ResetPasswordResult>> {
    return this.t.json<ResetPasswordResult>({ method: "POST", path: `/servers/${serverId}/actions/reset-password`, ...options });
  }
}

/** `/servers/{id}/ips` — additional IPv4 addresses and PTR records. */
export class ServerIpsResource {
  constructor(private readonly t: Transport) {}

  /** Addresses of the server (`servers:read`). */
  list(serverId: number, options?: RequestOptions): Promise<ListResult<Ip>> {
    return this.t.json<{ data: Ip[] }>({ method: "GET", path: `/servers/${serverId}/ips`, ...options });
  }

  /** Price of one more IPv4 for this server (`servers:read`). */
  quote(serverId: number, options?: RequestOptions): Promise<WithMeta<IpQuote>> {
    return this.t.json<IpQuote>({ method: "GET", path: `/servers/${serverId}/ips/quote`, ...options });
  }

  /**
   * Buy an additional IPv4 (`servers:order`). Idempotent; charges the prorated
   * price for the rest of the paid period. The address itself is not in the
   * answer — the panel assigns it asynchronously, read it from `list()`.
   */
  add(serverId: number, options?: RequestOptions): Promise<WithMeta<IpAdded>> {
    return this.t.json<IpAdded>({ method: "POST", path: `/servers/${serverId}/ips`, idempotent: true, ...options });
  }

  /** Release an additional IPv4 (`servers:order`). The primary address cannot be released. */
  delete(serverId: number, ipId: number, options?: RequestOptions): Promise<WithMeta<IpDeleted>> {
    return this.t.json<IpDeleted>({ method: "DELETE", path: `/servers/${serverId}/ips/${ipId}`, ...options });
  }

  /**
   * Set or remove the PTR (reverse DNS) record (`servers:manage`).
   *
   * The API field is `domain`, not `ptr` — an empty string (or `null`)
   * removes the record. The answer is `{ id, ptr }`, not the whole address.
   */
  setPtr(serverId: number, ipId: number, ptr: string | null, options?: RequestOptions): Promise<WithMeta<PtrRecord>> {
    const body: PtrUpdate = { domain: ptr ?? "" };
    return this.t.json<PtrRecord>({ method: "PUT", path: `/servers/${serverId}/ips/${ipId}/ptr`, body, ...options });
  }
}

/** `/orders` — server orders in progress after a `202 provisioning`. */
export class OrdersResource {
  constructor(private readonly t: Transport) {}

  /** Server orders, newest first (`servers:read`). */
  list(params: OrderListParams = {}, options?: RequestOptions): Promise<Page<Order>> {
    return this.t.page<Order>({ method: "GET", path: "/orders", query: { ...params }, ...options });
  }

  /** Order state by its invoice id (`servers:read`). Terminal states: `active`, `failed`. */
  get(invoiceId: number, options?: RequestOptions): Promise<WithMeta<Order>> {
    return this.t.json<Order>({ method: "GET", path: `/orders/${invoiceId}`, ...options });
  }

  /**
   * Polls `get()` until the order is `active`, `failed` or `cancelled`.
   * Throws `Error` on `timeoutMs` (default 10 minutes); polls every `intervalMs` (default 5 s).
   */
  async wait(
    invoiceId: number,
    { intervalMs = 5_000, timeoutMs = 600_000, signal }: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<WithMeta<Order>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const order = await this.get(invoiceId, signal ? { signal } : undefined);
      if (order.status !== "provisioning") return order;
      if (Date.now() + intervalMs > deadline) {
        throw new Error(`Order ${invoiceId} is still provisioning after ${timeoutMs} ms`);
      }
      await new Promise<void>((resolve, reject) => {
        const aborted = () => (signal!.reason instanceof Error ? signal!.reason : new Error("Aborted"));
        if (signal?.aborted) return reject(aborted());
        // Слушателя снимаем в обеих ветках: заказ опрашивается до 120 раз,
        // и накопленные подписки на один signal дают
        // MaxListenersExceededWarning уже после одиннадцатой.
        let onAbort = () => {};
        const t = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, intervalMs);
        onAbort = () => {
          clearTimeout(t);
          reject(aborted());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }
}

/** `/servers` — list, order, details, update, delete with refund, renew; plus `actions`, `ips`, `orders`. */
export class ServersResource {
  readonly actions: ServerActionsResource;
  readonly ips: ServerIpsResource;
  readonly orders: OrdersResource;

  constructor(private readonly t: Transport) {
    this.actions = new ServerActionsResource(t);
    this.ips = new ServerIpsResource(t);
    this.orders = new OrdersResource(t);
  }

  /** Servers of the account (`servers:read`). `ip` finds a server by any assigned address. */
  list(params: ServerListParams = {}, options?: RequestOptions): Promise<Page<Server>> {
    return this.t.page<Server>({ method: "GET", path: "/servers", query: { ...params }, ...options });
  }

  /**
   * Order a server (`servers:order`). Idempotent and expensive.
   * `201` → `ServerCreated` with the one-time `root_password`;
   * `202` → `Order` with `status: "provisioning"` — poll `orders.get()` / `orders.wait()`.
   * Tell them apart with `"server" in result`.
   */
  create(body: ServerCreate, options?: RequestOptions): Promise<WithMeta<ServerCreated | Order>> {
    return this.t.json<ServerCreated | Order>({ method: "POST", path: "/servers", body, idempotent: true, ...options });
  }

  /** Server details with `refund_quote`; `include: "live"` adds panel power state and usage. */
  get(serverId: number, params: ServerGetParams = {}, options?: RequestOptions): Promise<WithMeta<ServerDetail>> {
    return this.t.json<ServerDetail>({ method: "GET", path: `/servers/${serverId}`, query: { ...params }, ...options });
  }

  /** Change auto-renew, name or notes (`servers:manage`). */
  update(serverId: number, body: ServerUpdate, options?: RequestOptions): Promise<WithMeta<Server>> {
    return this.t.json<Server>({ method: "PATCH", path: `/servers/${serverId}`, body, ...options });
  }

  /** Delete the server and refund unused days (`servers:delete`). Idempotent. */
  delete(serverId: number, options?: RequestOptions): Promise<WithMeta<DeleteResult>> {
    return this.t.json<DeleteResult>({ method: "DELETE", path: `/servers/${serverId}`, idempotent: true, ...options });
  }

  /** Live power state and usage from the panel (`servers:read`, expensive bucket). */
  status(serverId: number, options?: RequestOptions): Promise<WithMeta<ServerLiveStatus>> {
    return this.t.json<ServerLiveStatus>({ method: "GET", path: `/servers/${serverId}/status`, ...options });
  }

  /** What `delete()` would refund right now (`servers:read`). */
  refundQuote(serverId: number, options?: RequestOptions): Promise<WithMeta<RefundQuote>> {
    return this.t.json<RefundQuote>({ method: "GET", path: `/servers/${serverId}/refund-quote`, ...options });
  }

  /** Renew for months or hours from balance (`servers:order`). Idempotent. */
  renew(serverId: number, body: RenewRequest, options?: RequestOptions): Promise<WithMeta<RenewResult>> {
    return this.t.json<RenewResult>({ method: "POST", path: `/servers/${serverId}/renew`, body, idempotent: true, ...options });
  }
}
