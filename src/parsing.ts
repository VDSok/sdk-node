/**
 * Помощники для «сырых» значений API.
 *
 * Общий дизайн SDK (план §9) говорит «деньги строками/Decimal, даты в
 * нативные типы». В Python и PHP это выполнимо без потерь: там есть Decimal и
 * DateTimeImmutable, и SDK конвертируют поля на выходе. В TypeScript
 * конвертация на выходе означала бы, что типы, сгенерированные из OpenAPI,
 * расходятся с тем, что реально лежит в объекте (`created_at: string` в типе,
 * Date в рантайме), и что `JSON.stringify(result)` больше не равен телу
 * ответа. Поэтому node-SDK сознательно отступает от §9: поля приходят ровно
 * такими, какими их прислал API, а нативные типы — это явный вызов
 * `parseTimestamp()`.
 */

/**
 * RFC 3339 timestamp from the API (`"2026-09-15T10:00:00Z"`) as a `Date`.
 *
 * ```ts
 * const server = await client.servers.get(2001);
 * parseTimestamp(server.created_at);      // Date
 * parseTimestamp(server.cancelled_at);    // null
 * ```
 *
 * @throws {TypeError} when the string is not a date the runtime understands.
 */
export function parseTimestamp(value: string): Date;
export function parseTimestamp(value: string | null | undefined): Date | null;
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new TypeError(`Not an RFC 3339 timestamp: ${JSON.stringify(value)}`);
  return new Date(ms);
}

/**
 * A `Date` as the RFC 3339 UTC string the API expects in query filters
 * (`since`, `until`). Query builders accept `Date` directly, so this is only
 * needed when you assemble parameters by hand.
 */
export function formatTimestamp(value: Date): string {
  return value.toISOString();
}
