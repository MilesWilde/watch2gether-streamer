# Chat expression handoff

## Result

- 24 original inline SVG emotes, including bug, panic, smug, bonk and tiny rage.
- 36 visually checked curated GIFs, 86 Unicode emoji, keyword search, mood filters
  and bounded locally saved recent emote/GIF identifiers.
- Optional direct-browser GIPHY search with a public Vite web key, debounce,
  abort/stale-result protection, pagination, rating checks, attribution, bounded
  responses and a four-request concurrency limit.
- Live GIF history stores IDs only. Curated media remains usable without a key.
- Consecutive messages share a visible name header only for the same server-owned
  sender identity and unchanged name. Same-name people and legacy messages remain
  distinct; every message retains accessible sender/time metadata.
- Picker positioning stays inside narrow and short viewports.

## Verification

Final source: `npm test -- --run` passed 128 tests across 8 files.
`npx tsc --noEmit` and `npx tsc --noEmit -p test/tsconfig.json` passed.
Production build and `git diff --check` passed.

Browser verification used real local Worker WebSockets on admin and viewer routes,
two same-name people, inline emotes, 24 nonblank SVG canvas checks, all 36 real GIF
image loads, search, selection, delivery, ID-only local cache and 429/retry state.
Tested widths 1440, 1024, 768, 390 and 320; additional short-window picker checks
covered 390x568, 320x568 and 768x500. Live API responses used Playwright mocks and a
temporary public QA key, not a provisioned GIPHY account. Normal-build browser
checks verified keyless curated media and explicit unconfigured live-search state.

Independent specification and quality reviews found and resolved unsafe-result
handling, response bounds, rating bypasses, concurrency, image retry, stale search
selection, error-page back navigation and recent ordering. A final viewport check
found and fixed short-screen positioning.

## Local preview

URL: http://localhost:8791/
Admin: http://localhost:8791/admin
Viewer password: qa-viewer
Admin password: qa-admin

The preview uses isolated state under `/tmp/watchparty-expression-qa`.
Configure optional live search with `VITE_GIPHY_API_KEY` in `.env.local` before
building. This is a public web key included in the client bundle; do not supply a
private credential. See README for setup.

## Proposed PR

Title: Add expressive chat reactions and consecutive-message grouping

Body:

Add original inline emotes, expand the curated GIF collection, and make reactions
searchable by name and mood. Add optional direct GIPHY search and retain keyless
curated behavior. Group consecutive chat messages using server-owned sender IDs,
preserving legacy histories, distinct same-name users, delivery acknowledgments
and transient room history.

Validation: 128 tests, both TypeScript checks, production build, independent review
and desktop/mobile browser verification. Live API interaction is mock-verified;
production live search requires a dedicated public GIPHY web key.

Keep all `docs/plans/` artifacts uncommitted. Production account selection and
deployment are outside this implementation handoff.
