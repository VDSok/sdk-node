import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Page, Vdsok } from "../src/index.js";
import { FixtureServer, TEST_KEY, sampleServer } from "./helpers/fixture.js";

let fx: FixtureServer;
let client: Vdsok;

beforeEach(async () => {
  fx = new FixtureServer();
  await fx.start();
  client = new Vdsok(TEST_KEY, { baseUrl: fx.baseUrl });
  // Три страницы по два сервера; курсор — непрозрачная строка, которую SDK
  // обязан вернуть как есть вместе с исходными фильтрами.
  fx.on("GET", "/servers", (req) => {
    const cursor = req.query.get("cursor");
    const pageNo = cursor === null ? 1 : Number(cursor.replace("c_", ""));
    const data = [1, 2].map((i) => ({ ...sampleServer, id: pageNo * 10 + i }));
    return { body: { data, next_cursor: pageNo < 3 ? `c_${pageNo + 1}` : null } };
  });
});

afterEach(async () => {
  await fx.stop();
});

describe("Page", () => {
  it("exposes data, cursor and $meta for a single page", async () => {
    const page = await client.servers.list({ status: "active", limit: 2 });
    expect(page).toBeInstanceOf(Page);
    expect(page.data.map((s) => s.id)).toEqual([11, 12]);
    expect(page.nextCursor).toBe("c_2");
    expect(page.hasMore).toBe(true);
    expect(page.$meta.requestId).toBe("req_1");
    expect(Object.keys(page)).not.toContain("$meta");
    expect(JSON.parse(JSON.stringify(page))).toEqual({ data: page.data, next_cursor: "c_2" });
  });

  it("walks every page with for-await, preserving filters and passing cursors back", async () => {
    const page = await client.servers.list({ status: "active", limit: 2 });
    const ids: number[] = [];
    for await (const s of page) ids.push(s.id);
    expect(ids).toEqual([11, 12, 21, 22, 31, 32]);
    expect(fx.requests).toHaveLength(3);
    for (const r of fx.requests) {
      expect(r.query.get("status")).toBe("active");
      expect(r.query.get("limit")).toBe("2");
    }
    expect(fx.requests.map((r) => r.query.get("cursor"))).toEqual([null, "c_2", "c_3"]);
  });

  it("iterates pages() and nextPage() ends with null", async () => {
    const first = await client.servers.list();
    const pages: Page<unknown>[] = [];
    for await (const p of first.pages()) pages.push(p);
    expect(pages).toHaveLength(3);
    expect(pages[2]!.hasMore).toBe(false);
    expect(await pages[2]!.nextPage()).toBeNull();
    expect(pages[1]!.$meta.requestId).toBe("req_2");
  });

  it("toArray(max) stops fetching once enough items are collected", async () => {
    const first = await client.servers.list();
    const items = await first.toArray(3);
    expect(items.map((s) => s.id)).toEqual([11, 12, 21]);
    expect(fx.requests).toHaveLength(2);
    const all = await (await client.servers.list()).toArray();
    expect(all).toHaveLength(6);
  });

  it("keeps $meta read-only, like attachMeta does on plain results", async () => {
    const page = await client.servers.list();
    const descriptor = Object.getOwnPropertyDescriptor(page, "$meta")!;
    expect(descriptor).toMatchObject({ enumerable: false, writable: false, configurable: true });
    // В strict mode (а модули всегда strict) присваивание должно падать, а не
    // молча подменять метаданные страницы.
    expect(() => {
      (page as unknown as { $meta: unknown }).$meta = null;
    }).toThrow(TypeError);
  });

  it("lists that carry a null cursor today are still pages (keys, webhooks)", async () => {
    fx.on("GET", "/keys", { body: { data: [{ id: 3, name: "ci" }], next_cursor: null } });
    fx.on("GET", "/webhooks", { body: { data: [{ id: 5 }], next_cursor: null } });
    const keys = await client.keys.list();
    const hooks = await client.webhooks.list();
    expect(keys).toBeInstanceOf(Page);
    expect(hooks).toBeInstanceOf(Page);
    expect(keys.data.map((k) => k.id)).toEqual([3]);
    expect(keys.hasMore).toBe(false);
    expect(await hooks.toArray()).toHaveLength(1);
  });

  it("tolerates a list without next_cursor", async () => {
    fx.on("GET", "/domains", { body: { data: [{ id: 1 }] } });
    const page = await client.domains.list();
    expect(page.data).toEqual([{ id: 1 }]);
    expect(page.nextCursor).toBeNull();
    expect(await page.toArray()).toEqual([{ id: 1 }]);
  });
});
