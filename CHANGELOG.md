# Changelog

Built from the GitHub release notes. Each version links to its release page.

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
