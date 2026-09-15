import type {
  QueryOf,
  WebhookDeleted,
  WebhookDelivery,
  WebhookDeliveryWithPayload,
  WebhookEventDescriptor,
  WebhookRedelivery,
  WebhookSecret,
  WebhookSubscription,
  WebhookSubscriptionCreate,
  WebhookSubscriptionUpdate,
  WebhookSubscriptionWithSecret,
  WebhookTestResult,
} from "../api.js";
import type { RequestOptions, Transport } from "../client.js";
import type { WithMeta } from "../meta.js";
import type { Page } from "../pagination.js";
import { constructEvent, sign, verify } from "../webhooks.js";
import type { ListResult } from "./catalog.js";

export type WebhookDeliveryListParams = QueryOf<"list_webhook_deliveries">;

/**
 * `/webhooks` — subscriptions, deliveries, redelivery, test events (live keys
 * only; test keys get `403 sandbox_not_supported`). Also exposes the
 * signature helpers so `client.webhooks.verify(...)` works in receivers.
 */
export class WebhooksResource {
  /** See `Webhooks.verify`. */
  readonly verify = verify;
  /** See `Webhooks.constructEvent`. */
  readonly constructEvent = constructEvent;
  /** See `Webhooks.sign`. */
  readonly sign = sign;

  constructor(private readonly t: Transport) {}

  /**
   * Webhook subscriptions (`webhooks:manage`).
   *
   * Как и `/keys`, ручка отдаёт `next_cursor` (сейчас всегда null) — читаем
   * её страницей, чтобы будущий курсор не обрезал список молча.
   */
  list(options?: RequestOptions): Promise<Page<WebhookSubscription>> {
    return this.t.page<WebhookSubscription>({ method: "GET", path: "/webhooks", ...options });
  }

  /** Subscribe an `https://` URL to events; the `secret` is returned once (`webhooks:manage`). */
  create(body: WebhookSubscriptionCreate, options?: RequestOptions): Promise<WithMeta<WebhookSubscriptionWithSecret>> {
    return this.t.json<WebhookSubscriptionWithSecret>({ method: "POST", path: "/webhooks", body, ...options });
  }

  /** Event types you can subscribe to (`webhooks:manage`). */
  events(options?: RequestOptions): Promise<ListResult<WebhookEventDescriptor>> {
    return this.t.json<{ data: WebhookEventDescriptor[] }>({ method: "GET", path: "/webhooks/events", ...options });
  }

  /** One subscription (`webhooks:manage`). */
  get(webhookId: number, options?: RequestOptions): Promise<WithMeta<WebhookSubscription>> {
    return this.t.json<WebhookSubscription>({ method: "GET", path: `/webhooks/${webhookId}`, ...options });
  }

  /** Change URL, events, description; `active: true` re-enables after auto-disable (`webhooks:manage`). */
  update(webhookId: number, body: WebhookSubscriptionUpdate, options?: RequestOptions): Promise<WithMeta<WebhookSubscription>> {
    return this.t.json<WebhookSubscription>({ method: "PATCH", path: `/webhooks/${webhookId}`, body, ...options });
  }

  /** Delete a subscription and its delivery log (`webhooks:manage`). */
  delete(webhookId: number, options?: RequestOptions): Promise<WithMeta<WebhookDeleted>> {
    return this.t.json<WebhookDeleted>({ method: "DELETE", path: `/webhooks/${webhookId}`, ...options });
  }

  /**
   * Issue a new signing secret; the old one stops working immediately
   * (`webhooks:manage`). Возвращается только `{id, secret}` — сама подписка
   * не меняется, перечитывать её не нужно.
   */
  rotateSecret(webhookId: number, options?: RequestOptions): Promise<WithMeta<WebhookSecret>> {
    return this.t.json<WebhookSecret>({ method: "POST", path: `/webhooks/${webhookId}/rotate-secret`, ...options });
  }

  /** Send a `ping` event now and report the receiver's status and latency (`webhooks:manage`, expensive). */
  test(webhookId: number, options?: RequestOptions): Promise<WithMeta<WebhookTestResult>> {
    return this.t.json<WebhookTestResult>({ method: "POST", path: `/webhooks/${webhookId}/test`, ...options });
  }

  /** Delivery log, newest first (`webhooks:manage`). */
  deliveries(webhookId: number, params: WebhookDeliveryListParams = {}, options?: RequestOptions): Promise<Page<WebhookDelivery>> {
    return this.t.page<WebhookDelivery>({
      method: "GET",
      path: `/webhooks/${webhookId}/deliveries`,
      query: { ...params },
      ...options,
    });
  }

  /**
   * One delivery with the exact `payload` that was signed and sent
   * (`webhooks:manage`). Единственная ручка, которая отдаёт payload — в
   * списке доставок его нет.
   */
  delivery(deliveryId: number, options?: RequestOptions): Promise<WithMeta<WebhookDeliveryWithPayload>> {
    return this.t.json<WebhookDeliveryWithPayload>({
      method: "GET",
      path: `/webhooks/deliveries/${deliveryId}`,
      ...options,
    });
  }

  /** Re-queue a delivery with the same bytes as the original event (`webhooks:manage`, expensive). */
  redeliver(deliveryId: number, options?: RequestOptions): Promise<WithMeta<WebhookRedelivery>> {
    return this.t.json<WebhookRedelivery>({ method: "POST", path: `/webhooks/deliveries/${deliveryId}/redeliver`, ...options });
  }
}
