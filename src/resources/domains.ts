import type {
  AvailabilityResult,
  Domain,
  DomainOrderResult,
  DomainRegister,
  DomainRenewResult,
  DomainTransfer,
  DomainTransferResult,
  DomainUpdate,
  NameserversUpdate,
  QueryOf,
} from "../api.js";
import type { RequestOptions, Transport } from "../client.js";
import type { WithMeta } from "../meta.js";
import type { Page } from "../pagination.js";

export type DomainListParams = QueryOf<"list_domains">;

/** `/domains` — availability, registration, renewal, nameservers, privacy, transfers. */
export class DomainsResource {
  constructor(private readonly t: Transport) {}

  /** Is the name free to register (`domains:read`, expensive bucket). IDN allowed. */
  checkAvailability(name: string, options?: RequestOptions): Promise<WithMeta<AvailabilityResult>> {
    return this.t.json<AvailabilityResult>({ method: "GET", path: "/domains/availability", query: { name }, ...options });
  }

  /** Domains of the account (`domains:read`). */
  list(params: DomainListParams = {}, options?: RequestOptions): Promise<Page<Domain>> {
    return this.t.page<Domain>({ method: "GET", path: "/domains", query: { ...params }, ...options });
  }

  /**
   * Register a domain (`domains:order`). Idempotent.
   * `status: "registered"` (201) or `"pending"` (202, becomes active on the next sync).
   */
  register(body: DomainRegister, options?: RequestOptions): Promise<WithMeta<DomainOrderResult>> {
    return this.t.json<DomainOrderResult>({ method: "POST", path: "/domains", body, idempotent: true, ...options });
  }

  /** One domain (`domains:read`). */
  get(domainId: number, options?: RequestOptions): Promise<WithMeta<Domain>> {
    return this.t.json<Domain>({ method: "GET", path: `/domains/${domainId}`, ...options });
  }

  /** Toggle auto-renew or WHOIS privacy (`domains:manage`). */
  update(domainId: number, body: DomainUpdate, options?: RequestOptions): Promise<WithMeta<Domain>> {
    return this.t.json<Domain>({ method: "PATCH", path: `/domains/${domainId}`, body, ...options });
  }

  /** Renew for N years from balance (`domains:order`). Idempotent. */
  renew(domainId: number, years: number, options?: RequestOptions): Promise<WithMeta<DomainRenewResult>> {
    return this.t.json<DomainRenewResult>({
      method: "POST",
      path: `/domains/${domainId}/renew`,
      body: { years },
      idempotent: true,
      ...options,
    });
  }

  /** Replace the nameserver set, exactly two hosts (`domains:manage`). */
  setNameservers(domainId: number, nameservers: string[], options?: RequestOptions): Promise<WithMeta<Domain>> {
    const body: NameserversUpdate = { nameservers };
    return this.t.json<Domain>({ method: "PUT", path: `/domains/${domainId}/nameservers`, body, ...options });
  }

  /** Transfer a domain in from another registrar (`domains:order`). Idempotent; answers 202 `transfer_pending`. */
  transfer(body: DomainTransfer, options?: RequestOptions): Promise<WithMeta<DomainTransferResult>> {
    return this.t.json<DomainTransferResult>({ method: "POST", path: "/domains/transfers", body, idempotent: true, ...options });
  }
}
