import type { SshKey, SshKeyCreate } from "../api.js";
import type { RequestOptions, Transport } from "../client.js";
import type { ResponseMeta, WithMeta } from "../meta.js";
import type { ListResult } from "./catalog.js";

/** `/ssh-keys` — account-level public keys injected on order and reinstall. */
export class SshKeysResource {
  constructor(private readonly t: Transport) {}

  /** Public keys stored on the account (`servers:read`). */
  list(options?: RequestOptions): Promise<ListResult<SshKey>> {
    return this.t.json<{ data: SshKey[] }>({ method: "GET", path: "/ssh-keys", ...options });
  }

  /** Add a public key in OpenSSH one-line format (`servers:manage`). */
  create(body: SshKeyCreate, options?: RequestOptions): Promise<WithMeta<SshKey>> {
    return this.t.json<SshKey>({ method: "POST", path: "/ssh-keys", body, ...options });
  }

  /** Remove a public key (`servers:manage`). Does not touch servers where it is installed. Resolves with response metadata. */
  delete(keyId: number, options?: RequestOptions): Promise<ResponseMeta> {
    return this.t.empty({ method: "DELETE", path: `/ssh-keys/${keyId}`, ...options });
  }
}
