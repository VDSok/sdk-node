import type { ResponseMeta } from "./meta.js";

/**
 * One page of a cursor-paginated list plus lazy access to the rest.
 *
 * ```ts
 * const page = await client.servers.list({ limit: 50 });
 * page.data;            // Server[]
 * page.nextCursor;      // string | null
 * for await (const s of page) { … }   // walks every page transparently
 * ```
 *
 * Курсоры подписаны сервером и непрозрачны, поэтому единственный правильный
 * способ листать — вернуть `next_cursor` как есть; Page делает это сама и
 * сохраняет остальные параметры запроса (фильтры, limit).
 */
export class Page<T> implements AsyncIterable<T> {
  readonly data: T[];
  readonly nextCursor: string | null;
  /**
   * Объявлено через `declare`: свойство целиком создаёт defineProperty ниже.
   * Обычное поле класса при `useDefineForClassFields: false` не создавалось бы
   * вовсе, и присваивание после defineProperty падало бы в strict mode.
   */
  declare readonly $meta: ResponseMeta;
  readonly #fetchNext: (cursor: string) => Promise<Page<T>>;

  constructor(
    data: T[],
    nextCursor: string | null,
    meta: ResponseMeta,
    fetchNext: (cursor: string) => Promise<Page<T>>,
  ) {
    this.data = data;
    this.nextCursor = nextCursor;
    this.#fetchNext = fetchNext;
    // Неперечислимое свойство: `JSON.stringify(page)` отдаёт только данные.
    // Только для чтения — как у attachMeta(), чтобы $meta вёл себя одинаково
    // на страницах и на обычных результатах.
    Object.defineProperty(this, "$meta", { value: meta, enumerable: false, writable: false, configurable: true });
  }

  /** Whether another page exists. */
  get hasMore(): boolean {
    return this.nextCursor != null;
  }

  /** Fetches the next page, or resolves to `null` on the last one. */
  async nextPage(): Promise<Page<T> | null> {
    if (this.nextCursor == null) return null;
    return this.#fetchNext(this.nextCursor);
  }

  /** Iterates over pages, starting with this one. */
  async *pages(): AsyncGenerator<Page<T>, void, undefined> {
    let page: Page<T> | null = this;
    while (page) {
      yield page;
      page = await page.nextPage();
    }
  }

  /** Iterates over items across all pages, starting with this one. */
  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    for await (const page of this.pages()) {
      yield* page.data;
    }
  }

  /** Collects items across pages; `max` stops early (each page is still fetched whole). */
  async toArray(max: number = Infinity): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) {
      if (out.length >= max) break;
      out.push(item);
    }
    return out;
  }

  toJSON(): { data: T[]; next_cursor: string | null } {
    return { data: this.data, next_cursor: this.nextCursor };
  }
}
