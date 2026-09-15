import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  USER_AGENT,
  VERSION,
  formatTimestamp,
  parseTimestamp,
} from "../src/index.js";

describe("version", () => {
  it("matches package.json and the CHANGELOG head", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
    expect(USER_AGENT).toBe(`vdsok-sdk-node/${pkg.version}`);
    const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    expect(changelog).toMatch(new RegExp(`^## ${pkg.version.replace(/\\./g, "\\.")}`, "m"));
  });

  it("ships the shared SDK defaults", () => {
    expect(DEFAULT_BASE_URL).toBe("https://vdsok.guru/api/v1");
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_MAX_RETRIES).toBe(2);
  });
});

describe("timestamps", () => {
  it("parses RFC 3339 into Date, passes null through and rejects junk", () => {
    expect(parseTimestamp("2026-09-15T10:00:00Z")).toEqual(new Date(Date.UTC(2026, 8, 15, 10, 0, 0)));
    // Поля вроде cancelled_at приходят null — помощник не должен заставлять
    // вызывающего писать тернарник на каждое опциональное время.
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(() => parseTimestamp("not a date")).toThrow(TypeError);
    expect(formatTimestamp(new Date(Date.UTC(2026, 8, 1)))).toBe("2026-09-01T00:00:00.000Z");
  });
});
