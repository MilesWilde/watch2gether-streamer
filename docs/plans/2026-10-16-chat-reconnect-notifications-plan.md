# Reconnect and Notifications Implementation Plan

**Goal:** Preserve chat through transient disconnects and provide quiet tab counts.
**Architecture:** Keep actor-memory room history with a cancellable 60-second
alarm; add an explicit leave command; keep authenticated client snapshots while
suspended; isolate unread/title behavior in a hook owned by the app header.
**Stack:** React, TypeScript, Durable Objects, Vitest Workers pool, Playwright QA.

- [x] Inspect socket, room, chat storage, header and existing regression tests.
- [x] Write backend grace/explicit-leave regressions and observe failures.
- [x] Implement alarm cancellation/expiry, departure classification and logs.
- [x] Implement client suspension/cache preservation and disconnect diagnostics
  with focused lifecycle regressions (client worker).
- [x] Implement title-only notifications hook, header toggle and per-join reset
  with focused tests (notifications worker).
- [x] Run combined tests, both TypeScript configurations and production build.
- [x] Exercise reconnect/history/title/toggle/Leave in real Chromium clients.
- [x] Perform specification and quality review, fix findings and revalidate.

## Verification and Review Results

All 281 tests in 14 files pass; application and test TypeScript checks pass.
The production build passes with its existing large-bundle advisory.

Two real Chromium participants verified title counts, own-message exclusion,
focus/toggle clearing, default-on rejoin, disabled preference across reconnect,
history/cache retention through network drops and page suspension, missed-message
catch-up, sole-participant reconnect, final Leave cleanup, no document reload,
mobile header fit and redacted browser diagnostics.

Independent spec and quality reviews found and resolved two issues: late server
close metadata after earlier cleanup, and a playlist-import dialog trapped in
a disabled fieldset during reconnect. Backend regression proves close logging
and cleanup are each idempotent. Portal-based modal regression and browser
red/green checks prove offline Close/Cancel/local selection remain usable while
requesting stays disabled and the URL draft is retained.

Additional backend tests cover delayed alarm scheduling/cancellation races,
unauthenticated and failed-password isolation, exact compatibility Leave codes,
duplicate events and authenticated sender-ID agreement.

The compact Emoji/GIF browser suite also passes across six viewport sizes.
Preview remains `http://localhost:8793/`, local QA password `qa-viewer`.
Transient actor restarts intentionally create a new room session; no chat
transcript was added to server disk storage.

No migration or external account changes are needed. Keep plan artifacts
uncommitted; delivery is the working tree and local preview, not deployment.
