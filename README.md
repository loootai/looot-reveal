# looot-reveal

An open-source alternative to [RB2B](https://www.rb2b.com/pricing) and Clearbit Reveal: see which companies visit your website. RB2B starts at $0 for 150 identifications a month and $79 a month for 300 (public pricing page, read 2026-10-10). Clearbit Reveal now sells inside HubSpot Breeze Intelligence on a credit plan, with reported entry prices around $45 a month on top of a HubSpot seat (third-party reviews, read 2026-10-10). This repo runs on one looot key and you pay list price per lookup, about $0.0005 to find the company behind an IP.

It reads an access log, a CSV of IPs, or visits from a small tracking snippet. It looks each IP up through looot's IP intelligence provider, drops ISPs, hosting and VPNs, enriches the company that is left, and shows a feed of visiting companies with the pages they viewed and an ICP match flag.

![Visitors feed, light](docs/screenshots/feed-light.png)
![Visitors feed, dark](docs/screenshots/feed-dark.png)

## Company level only

This app never tries to name a person behind a visit. An IP address is personal data under the GDPR and UK GDPR, and joining a visit to a named individual needs consent in most places and runs into state privacy laws in the US. Business network owners are public registry data. So the app stops at the company. See [Privacy and consent](#privacy-and-consent).

## Three ways to run

Demo, no account and no token:

```bash
npm ci
npm run demo        # http://localhost:3520, made-up companies and RFC 5737 addresses
```

Headless CLI:

```bash
npm run reveal -- --input examples/access.log --dry-run      # prints the list-price cost, makes no call
LOOOT_TOKEN=... npm run reveal -- --input access.log --cap 0.50
```

Input is a combined-format access log, a CSV with an `ip` column (and optionally `path`, `timestamp`, `referrer`), JSON lines, or a bare list of IPs. Output goes to `reveal-out/visitors.json`, `visitors.csv` and `visitors.md`. Answers are cached in `state/reveal.json`, so an IP seen again costs nothing.

Web UI on the same engine:

```bash
cp .env.example .env.local   # set LOOOT_TOKEN
npm run build && npm start
```

Pages: Visitors (the feed), a company page with the signals behind its ICP flag, Import (paste or upload, see the quote, run), Settings (edit the config, delete data past retention, snippet), Privacy. Supabase and sign-in are not part of v0.1. State is one JSON file, so run it behind your own access control.

## What a run costs

The quote prints before any call. The lookup count is exact. The enrichment count is a ceiling, because most addresses belong to consumer ISPs and are dropped before any company call.

| Step | looot job | Endpoint | List price |
|---|---|---|---|
| IP to owner, location, network type, VPN flags | `ip.lookup` | `ipinfo--2` | $0.0005 per new IP |
| Free variant, owner name and domain only | `ip.lookup` | `ipinfo-lite` | $0 |
| Company profile from the domain | `company.enrich` | job with provider fallback | from $0.0019 per new company |

Prices read from the public catalog on 2026-10-10. Example at list price: 100 new IPs cost $0.05 to look up. If 15 of them are business networks, enrichment adds at most $0.0285, so about $0.08 in total. The worst case, every IP enriched, is $0.24. Repeat IPs and repeat companies are free.

Money rules

- The quote shows before any paid action, and the UI button shows the amount it will spend.
- `--cap` (or `spendCapUsd` in the config) stops the run before a call that would pass it.
- Each call sends a stable idempotency key per input and job (`reveal:ip.lookup:<ip>`), so a retry never pays twice.
- A run still in progress when waiting stops is stored as pending. The next run collects it with the same key. It is never treated as failed at $0.

## Signals behind the ICP flag

Every flag lists its signals. Weights and the threshold live in `reveal.config.json`.

| Signal | Value seen | Supplied by | Default weight |
|---|---|---|---|
| Industry matches a keyword list | company profile | `company.enrich` | 2 |
| Employee count in a range | company profile | `company.enrich` | 2 |
| Country in a list | company profile, else the IP lookup | `company.enrich` or `ip.lookup` | 1 |
| Viewed a page (for example `/pricing`) | your own visit data | not a looot call, $0 | 3 |

A company matches when matched weights reach the threshold (default 4 of 8). The company page shows each signal, whether it matched, the value seen, its weight, the provider that supplied it and the cost of that call. A call that fed several signals shows its full cost on each row. There is no hidden score.

## Install for agents

```bash
git clone https://github.com/loootai/looot-reveal && cd looot-reveal && npm ci
npm run reveal -- --input examples/access.log --dry-run
```

The Claude Code skill is in `skills/looot-reveal/SKILL.md` (copy it to `~/.claude/skills/`). `public/llms.txt` summarises the commands. The skill always dry-runs first and never raises the cap on its own.

## Privacy and consent

- An IP is personal data in the EU and UK. Use a consent banner before the snippet sends anything. The snippet waits for `window.revealGrant()`, and sends nothing when the browser signals Global Privacy Control or Do Not Track.
- After an IP has an answer, only a salted hash is stored (`storeRawIp: false`). The idempotency key, which contains the IP, is stored hashed too.
- Query strings are cut from paths before storage. They often hold emails and tokens.
- `retentionDays` (default 30) deletes visits and stored answers past the window on each CLI run and from Settings.
- Consumer ISP, mobile, hosting and VPN addresses are excluded from the feed.
- Name looot and IPinfo as processors in your privacy policy. This is not legal advice.

## Tracking snippet

```html
<script src="https://YOUR-HOST/reveal.js" defer></script>
<script>/* after the visitor accepts your banner */ window.revealGrant && window.revealGrant();</script>
```

It sends the page path and the referrer origin. The server reads the IP from `x-forwarded-for` and stores it only until it is resolved. Collecting costs nothing. Looking up costs money and happens only when you click Run or run the CLI.

## What is not tested

- No paid looot run was made. Parsing of the IPinfo and company answers is built from IPinfo's public field list and from fixtures, not from recorded paid responses. Which fields the `ipinfo--2` plan returns (company, ASN type, privacy flags) depends on the IPinfo tier behind looot. When only the ASN name is present, the app falls back to the `networkNameHints` list in the config to spot ISPs, and that list is a heuristic.
- The `company.enrich` job answer is read by looking for common field names. Providers differ, so a missing field shows as "unknown".
- The tracking snippet and collect route were not load tested and have no rate limit.
- Dropped on purpose: person-level identification, email finding, and a hosted multi-user mode.

## Develop

```bash
npm test && npm run typecheck && npm run lint && npm run build
npm run leak-scan
git config core.hooksPath .githooks
```

Stack: TypeScript, Next.js App Router, Tailwind. Built on [looot](https://looot.ai): one key and one prepaid balance for 2,500+ data endpoints, failed calls cost nothing.

## Licence

MIT, copyright looot.
