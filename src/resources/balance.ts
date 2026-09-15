import type { Balance, QueryOf, TopupInfo, TopupRequest, TopupResult, Transaction } from "../api.js";
import type { RequestOptions, Transport } from "../client.js";
import type { WithMeta } from "../meta.js";
import type { Page } from "../pagination.js";

export type TransactionListParams = Omit<QueryOf<"list_transactions">, "since" | "until"> & {
  /** Only transactions created at or after this moment (RFC 3339 string or Date). */
  since?: string | Date;
  until?: string | Date;
};

/** `GET /balance`, `GET /transactions`, `GET /balance/topup-info`, `POST /balance/topup`. */
export class BalanceResource {
  constructor(private readonly t: Transport) {}

  /** Balance and upcoming charges (`balance:read`). */
  get(options?: RequestOptions): Promise<WithMeta<Balance>> {
    return this.t.json<Balance>({ method: "GET", path: "/balance", ...options });
  }

  /** Balance transactions, newest first (`balance:read`). Iterate the page to walk all of them. */
  transactions(params: TransactionListParams = {}, options?: RequestOptions): Promise<Page<Transaction>> {
    return this.t.page<Transaction>({ method: "GET", path: "/transactions", query: { ...params }, ...options });
  }

  /** Top-up limits and available gateways (`balance:read`). */
  topupInfo(options?: RequestOptions): Promise<WithMeta<TopupInfo>> {
    return this.t.json<TopupInfo>({ method: "GET", path: "/balance/topup-info", ...options });
  }

  /**
   * Create a top-up invoice and get a payment link (`balance:topup`).
   * Idempotent: an `Idempotency-Key` is generated unless `options.idempotencyKey` is given.
   */
  topup(body: TopupRequest, options?: RequestOptions): Promise<WithMeta<TopupResult>> {
    return this.t.json<TopupResult>({ method: "POST", path: "/balance/topup", body, idempotent: true, ...options });
  }
}
