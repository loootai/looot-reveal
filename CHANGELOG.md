# Changelog

Built from the GitHub release notes. Each version links to its release page.

## Unreleased

- Sign-in from Chrome no longer fails with "Cross-site request refused". The app sends `Referrer-Policy: no-referrer`, so Chrome posts forms with `Origin: null`. The same-origin check now falls back to `Sec-Fetch-Site: same-origin` for that case and still refuses `Origin: null` from another site. Test in `src/lib/auth/sameOrigin.test.ts`.

## 0.2.2 (2026-10-11)

Spend limits. Before this, a run was limited only by a cap that lived inside one run. The resolve and person-run routes read `capUsd` from the request body, so a caller could raise it. Nothing limited spend across runs, two runs started together each began at zero, and a refresh of an expired address used a key with the date in it, so it paid again each day.

- The cap per run comes only from server config (`spendCapUsd`, `personLevel.spendCapUsd`). `/api/resolve` and `/api/person/run` no longer read the request body. A test sends `capUsd: 1000` and checks the config cap holds.
- Period budget: a daily and a monthly amount (UTC), $10 and $50 by default, kept in `budget.json` next to the state file. The signed-in owner changes it on the Costs page (`PUT /api/budget`, session and CSRF). A run request cannot raise it. `LOOOT_REVEAL_DAILY_USD` and `LOOOT_REVEAL_MONTHLY_USD` set the starting values.
- Reserve then settle: each looot call (IP lookup, company enrichment, person enrichment) reserves its list price under a lock file before it is made, and is refused if used plus reserved plus the price would pass either budget. The reservation becomes the real cost when the call ends and goes back when looot answers with an error. A call still running keeps its reservation and is never counted as $0. The next run looks up pending calls with `GET /v1/runs/{id}` and settles them. A reservation that cannot be looked up is released after 24 hours.
- Stable keys: the date is gone from the key of a refreshed address. The refresh key names the cache period (`...:p<n>`), so asking again in the same period sends the same key and is not charged twice. A settled key is remembered for the month and not counted again.
- The sidebar spend panel and the Costs page show used, reserved and remaining for today and this month. The CLI refuses a run above what is left of the budget unless `--partial` is passed.
- `budget.json` stores hashes of keys, never an IP address or an email hash, and keeps no answers.

Migration: none. This repo has no database. `budget.json` is created on first use. Run one instance on a persistent disk, since the file is not shared between hosts. The looot token balance is still the final limit.

[Release page](https://github.com/loootai/looot-reveal/releases/tag/v0.2.2)

## 0.2.1 (2026-10-11)

Security release. Earlier versions (v0.2.0 and older) had no admin authentication. Anyone who could reach a deployed instance could read visitors and people, change settings and caps, start paid looot runs, and edit the suppression list. If you run v0.2.0 or older on a reachable host, upgrade to v0.2.1 and set REVEAL_ADMIN_PASSWORD.

What changed
- Every page and API route is now public on purpose or admin. The route map is in the README and a test fails if a route is missing from it.
- Admin routes need a password, a signed httpOnly session cookie and a CSRF token. With no password set they stay closed and /login shows a setup page.
- Person-level identification needs admin auth.
- /api/collect only accepts origins listed in allowedOrigins (new config key, empty by default, so add your site), with size and rate limits. /api/optout is rate limited and gives the same answer whether or not an address was stored.
- Security headers on all responses, no-store on admin responses.
- npm run demo refuses to start next to a LOOOT_TOKEN or a data file unless a password is set.

See Securing a deployment in the README.

[Release page](https://github.com/loootai/looot-reveal/releases/tag/v0.2.1)

## 0.2.0 (2026-10-11)

Optional person-level identification slot, US only, off by default. It ships with no supplier and looot supplies no person-level visitor identity. Turning it on needs a date and five ticked conditions, or the config does not load. Checks in code: US allow-list with EU, EEA, UK and CH always blocked, Global Privacy Control and Do Not Track, consent gate, suppression list, public opt-out page, retention, delete by email, audit log. Identity comes from an email hash your site holds, a generic HTTP adapter for your own supplier, or a looot enrichment call (People Data Labs person enrich, which takes email_hash in the public catalog) with a quote first and the cap enforced. New pages: People, Person-level setup, Suppression and opt-out, Audit log, /optout. Company-level is unchanged. 158 tests.

[Release page](https://github.com/loootai/looot-reveal/releases/tag/v0.2.0)

## 0.1.2 (2026-10-10)

Sidebar layout. Provider waterfall for IP to company (IPinfo Lite, IPinfo, People Data Labs off by default), per-IP cache, worst-case quote, cap enforced before every call, low-confidence marking when providers disagree. CLI and web UI now share data/reveal.json.

[Release page](https://github.com/loootai/looot-reveal/releases/tag/v0.1.2)

## 0.1.1 (2026-10-10)

Dependency security bump. next and eslint-config-next 16.3.7 to 16.3.8, which fixes six Next.js advisories (GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-39w2-rjm5-chcv, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, GHSA-cjq9-62q9-8jv4). No code changes. v0.1.0 is unchanged.

[Release page](https://github.com/loootai/looot-reveal/releases/tag/v0.1.1)

## 0.1.0 (2026-10-09)

First release. Demo mode, headless CLI with --dry-run and a spend cap, web UI, tracking snippet, explainable ICP flag. No paid looot run was made; parsing is built from docs and fixtures. See the README section on what is not tested.

[Release page](https://github.com/loootai/looot-reveal/releases/tag/v0.1.0)
