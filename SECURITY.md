# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x (latest release) | yes |
| < 1.0 | never released |

Fixes ship as a new patch release on npm (`@vdsok/sdk`). Only the latest 1.x
release is patched, so please check that the problem still reproduces on it.

## Reporting a vulnerability

Please do **not** open a public issue. Write to:

- email **support@vdsok.guru** with `security` in the subject;
- Telegram [@vdsok_support](https://t.me/vdsok_support).

We aim to reply within 24 hours and say whether we could reproduce it. Please
keep the finding private until a fixed version is on npm.

Include:

- the SDK version (`VERSION` export or `package.json`) and Node.js version;
- steps or a short script that reproduces the problem;
- what an attacker gains and under which conditions;
- if real API requests were involved: the endpoint, your source IP and the
  time, so we can find them in our logs.

## Scope

In scope — this package's code, for example:

- the API key leaking into error messages, logs, `User-Agent` or anywhere
  other than the `Authorization` header;
- bypassing webhook signature verification (`Webhooks.verify` /
  `Webhooks.constructEvent`), including timestamp tolerance and replay;
- retries that repeat a money operation without its `Idempotency-Key`;
- requests sent somewhere other than the configured `baseUrl`, or header and
  path injection through user-supplied values;
- anything in the published npm tarball (the package has no runtime
  dependencies).

Vulnerabilities in the VDSok API or the website itself are welcome through the
same channels.

Out of scope:

- advisories for development-only dependencies (vitest, vite, esbuild, …)
  that do not end up in the published package;
- denial-of-service and load testing against production;
- other customers' servers and accounts — test only with your own account.
  A sandbox API key, which never touches money, is issued in the dashboard
  at `/my/api`.

## If your API key leaked

Revoke it yourself in the dashboard at `/my/api` and create a new one — this
takes effect immediately. Then let us know if you suspect it was used: the
request log shows where it was used from and what was done with it.

---

**По-русски:** нашли уязвимость в SDK или API — напишите на
**support@vdsok.guru** (в теме `security`) или в
[@vdsok_support](https://t.me/vdsok_support), не в публичный issue. Приложите
версию SDK, шаги воспроизведения и, если были запросы к API, эндпоинт, ваш IP и
время. Исправления выходят патч-релизом последней версии 1.x. Утёк ключ — сразу
отзовите его в кабинете `/my/api`.
