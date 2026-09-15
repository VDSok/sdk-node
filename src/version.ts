// Версия SDK для User-Agent. Дублирует package.json намеренно: читать
// package.json в рантайме нельзя (ESM/CJS, бандлеры), а тест version.test.ts
// следит, чтобы значения не разъехались.
export const VERSION = "1.0.0";
export const USER_AGENT = `vdsok-sdk-node/${VERSION}`;
export const DEFAULT_BASE_URL = "https://vdsok.guru/api/v1";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
