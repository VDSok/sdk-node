import type { Location, OsImage, QueryOf, Quote, Tariff, Zone } from "../api.js";
import type { RequestOptions, Transport } from "../client.js";
import type { WithMeta } from "../meta.js";

export type TariffListParams = QueryOf<"list_tariffs">;
export type OsListParams = QueryOf<"list_os_images">;
export type QuoteParams = QueryOf<"get_quote">;

/** A plain `{data: [...]}` list; `$meta` sits on the wrapper. */
export type ListResult<T> = WithMeta<{ data: T[] }>;

/** `GET /catalog/*`. Needs a valid key, no scope. */
export class CatalogResource {
  constructor(private readonly t: Transport) {}

  /** VDS tariffs available for order; prices include the caller's group discount. */
  tariffs(params: TariffListParams = {}, options?: RequestOptions): Promise<ListResult<Tariff>> {
    return this.t.json<{ data: Tariff[] }>({ method: "GET", path: "/catalog/tariffs", query: { ...params }, ...options });
  }

  /** One tariff. */
  tariff(tariffId: number, options?: RequestOptions): Promise<WithMeta<Tariff>> {
    return this.t.json<Tariff>({ method: "GET", path: `/catalog/tariffs/${tariffId}`, ...options });
  }

  /** OS images; with `tariff_id` the list excludes images that tariff forbids. */
  os(params: OsListParams = {}, options?: RequestOptions): Promise<ListResult<OsImage>> {
    return this.t.json<{ data: OsImage[] }>({ method: "GET", path: "/catalog/os", query: { ...params }, ...options });
  }

  /** Datacenter locations. */
  locations(options?: RequestOptions): Promise<ListResult<Location>> {
    return this.t.json<{ data: Location[] }>({ method: "GET", path: "/catalog/locations", ...options });
  }

  /** Domain zones (TLDs) and prices. */
  zones(options?: RequestOptions): Promise<ListResult<Zone>> {
    return this.t.json<{ data: Zone[] }>({ method: "GET", path: "/catalog/zones", ...options });
  }

  /** Price of an order before placing it (expensive bucket). Give `months` or `hours`. */
  quote(params: QuoteParams, options?: RequestOptions): Promise<WithMeta<Quote>> {
    return this.t.json<Quote>({ method: "GET", path: "/catalog/quote", query: { ...params }, ...options });
  }
}
