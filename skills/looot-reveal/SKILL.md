---
name: looot-reveal
description: Turn a web server access log or a CSV of visitor IPs into a list of visiting companies with pages viewed and an ICP match flag. Company-level only. Use when asked which companies visited a website, to identify website visitors, or to score visiting accounts against an ICP.
---

# looot-reveal

Run from the repository root. Needs Node 20.9+ (Node 22.12+ for the tests) and `npm ci`. Token, balance and troubleshooting are in the README under "What you need" and "Troubleshooting".

1. Always dry run first and show the user the quote:
   `npm run reveal -- --input <file> --dry-run`
2. Ask the user to confirm the cost and the cap. Never raise `--cap` yourself.
3. Run it: `LOOOT_TOKEN=<token> npm run reveal -- --input <file> --cap <usd>`
   The token comes from the user's environment. Never print it or write it to a file.
4. Read `reveal-out/visitors.md` and report the ICP matches with the signals shown for each one.
5. If the output says IPs are pending, run the same command again. Pending runs are not charged twice.

Rules
- Company-level only. Do not try to name a person behind a visit.
- The input may hold personal data (IPs). Do not copy it into chat. Report companies, not addresses.
- Change ICP weights in `reveal.config.json`, not in code.
