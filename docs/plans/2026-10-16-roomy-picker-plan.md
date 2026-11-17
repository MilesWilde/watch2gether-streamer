# Roomy Picker Implementation Plan

**Goal:** Provide a bounded, optional reload fallback for the approved picker.

**Architecture:** A standalone TypeScript state module accepts injected storage.
The mounted picker owns live state; the provider hook keeps live results only in
memory. This plan stays uncommitted and does not authorize deployment.

**Tech Stack:** TypeScript, Vitest, existing Workers test pool.

## Sidecar Tasks

- [x] Inspect existing storage utilities and Vitest conventions.
- [x] Record the approved overlay, infinite-scroll, and persistence design.
- [x] Run the initial 96/48 count regression and observe a failing assertion.
- [x] Add tests for defaults, round trips, allowlists, limits, storage failures,
  accessors, and extra-field exclusion in `test/chat-picker-state.test.ts`.
- [x] Implement the exact exported types and three requested functions in
  `src/client/lib/chatPickerState.ts` using fresh defaults and bounded projection.
- [x] Run `npm test -- --run test/chat-picker-state.test.ts` and review results.
- [x] Review only owned changes and report the API, files, and test results.

## Sidecar Results

The initial regression failed with `expected undefined to be 96` before the
module existed. The completed focused suite passes all 43 tests. The Workers
test pool required escalated local socket access. The requested exported API
is unchanged; version 1 stores `{ version, tab, emoji, gif }` at the global key.
Invalid fields use defaults rather than clamping or coercing. The owned-file
whitespace check passes. All four sidecar files remain uncommitted.

## Integration Responsibilities

Main keeps the picker mounted, handles overlay close/focus trapping/body scroll
lock, appends 96 emoji/48 GIF items near the bottom, restores each view's scroll,
and flushes preferences on close/pagehide/unmount. The provider-hook agent owns
independent paginated live requests and memory-only result storage. Those tasks
are outside this sidecar's file ownership and completion claim.

## Integrated Implementation

- [x] Expand the picker to a viewport-sized, responsive modal with pinned tabs,
  filters and credits, close/Escape actions, focus trapping and body scroll lock.
- [x] Append local Emoji and GIF batches with infinite scrolling; automatically
  fill large viewports and retain earlier results.
- [x] Add independent live GIF paging, cancellation, stale-response protection,
  failed-page retry and memory-only provider results.
- [x] Keep the picker mounted and retain per-tab query, filters, loaded count and
  scroll position across close/reopen; persist bounded reload bookmarks.
- [x] Prevent partial live pages from overwriting a deep saved scroll position;
  allow intentional wheel/touch/keyboard scrolling to take over.
- [x] Add regression tests for deep GIF bookmarks and GIF-tab focus trapping;
  confirm both fail with their respective fixes removed and pass when restored.
- [x] Verify desktop/mobile Chromium layouts at six viewport sizes, lazy image
  pixels, real local GIF sending, separate tab bookmarks and reload restoration.
- [x] Verify mocked live-provider paging order, deep reload restoration, reopen
  without refetch, failed-page retry and exclusion of provider URLs from storage.
- [x] Update README documentation for infinite scrolling and remembered views.
- [x] Fix review finding: synchronize completed live-page counts independently
  of scroll events so immediate Escape/reload saves all loaded pages.
- [x] Pass all 231 tests in 12 files, application/test TypeScript checks and the
  production build. Vite retains its existing large-bundle advisory.

Preview: `http://localhost:8793/`, isolated local QA room password `qa-viewer`.
Browser scripts and screenshots are in `/tmp/watchparty-*-picker-*`.
The ordinary build is restored after the mocked public-key browser check.

## Approved Size and Anchor Follow-up

The user revised the panel to 320 by 360 pixels, opening beside the mouse click
instead of a viewport-sized or fixed bottom-right layout. Keyboard activation
uses the trigger bounds. CSS clamps placement to 8px viewport margins, including
after resize; filters stay stacked at this smaller panel width.

- [x] Add pointer/reopen and keyboard-anchor regressions; observe both fail
  before implementation and pass afterward.
- [x] Pass all 233 tests, application/test TypeScript checks and production build.
- [x] Browser-check six viewport sizes, three pointer locations (including screen
  edges), keyboard activation, infinite scrolling and remembered positions.
- [x] Complete focused code review with no blockers.
