import type { ApiKey, ApiKeyRevoked } from "../api.js";
import type { RequestOptions, Transport } from "../client.js";
import type { WithMeta } from "../meta.js";
import type { Page } from "../pagination.js";

/** `/keys` — API keys visible to the caller; a key can revoke itself. */
export class KeysResource {
  constructor(private readonly t: Transport) {}

  /**
   * API keys of the account, never the secret itself (`keys:read`).
   *
   * Ответ содержит `next_cursor` (сейчас всегда null), поэтому листаем его
   * как обычную страницу: когда у ручки появится настоящий курсор, SDK не
   * начнёт молча терять ключи.
   */
  list(options?: RequestOptions): Promise<Page<ApiKey>> {
    return this.t.page<ApiKey>({ method: "GET", path: "/keys", ...options });
  }

  /** One API key (`keys:read`). */
  get(keyId: number, options?: RequestOptions): Promise<WithMeta<ApiKey>> {
    return this.t.json<ApiKey>({ method: "GET", path: `/keys/${keyId}`, ...options });
  }

  /**
   * Revoke a key — kill switch. Only the key making the request can be
   * revoked here (whatever its scopes); pass the id of the calling key.
   * Other keys are revoked in the cabinet.
   */
  revoke(keyId: number, options?: RequestOptions): Promise<WithMeta<ApiKeyRevoked>> {
    return this.t.json<ApiKeyRevoked>({ method: "DELETE", path: `/keys/${keyId}`, ...options });
  }

  /** Looks up the calling key via `GET /me` and revokes it. */
  async revokeSelf(options?: RequestOptions): Promise<WithMeta<ApiKeyRevoked>> {
    const me = await this.t.json<{ key: ApiKey }>({ method: "GET", path: "/me", ...options });
    return this.revoke(me.key.id, options);
  }
}
