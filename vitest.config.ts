import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Тесты поднимают реальный node:http сервер; сетевые таймауты в SDK
    // проверяются короткими значениями, но запас на медленной машине нужен.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
