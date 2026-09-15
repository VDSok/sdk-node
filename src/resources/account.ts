import type { Account, Me } from "../api.js";
import type { RequestOptions, Transport } from "../client.js";
import type { WithMeta } from "../meta.js";

/** `GET /account`, `GET /me`. */
export class AccountResource {
  constructor(private readonly t: Transport) {}

  /** Profile, client group and discount (`account:read`). */
  get(options?: RequestOptions): Promise<WithMeta<Account>> {
    return this.t.json<Account>({ method: "GET", path: "/account", ...options });
  }

  /** Identity of the calling key, its scopes and limits; any valid key. */
  me(options?: RequestOptions): Promise<WithMeta<Me>> {
    return this.t.json<Me>({ method: "GET", path: "/me", ...options });
  }
}
