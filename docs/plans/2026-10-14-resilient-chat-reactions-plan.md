# Resilient Chat And Reactions Implementation Plan

**Goal:** Preserve the watch room during temporary connection loss and provide a unified, searchable collection of human-made reactions.

**Approved Design:** Keep the player and composer mounted after the first successful authentication. Suspend network actions until the connection and authoritative history are restored. Explicit Leave and rejected credentials clear private room state. A new server session replaces expired history without resetting an unsent draft.

**Architecture:** Separate connection readiness from room visibility and cached display state. Combine Unicode emoji and illustrated emotes into one Emoji tab, retain a separate GIF tab, and reuse one search model for caret-aware colon suggestions. Bound rendered picker results and lazy-load artwork. Preserve existing shortcode and GIF identifiers.

**Tech Stack:** React, TypeScript, Vitest, Cloudflare Workers and Durable Objects, Playwright.

## Tasks

- [x] Inspect current reconnect, composer, picker, and test contracts.
- [x] Add regressions for mounted room/history during reconnect and stable composer identity across authoritative session changes.
- [x] Run the regressions and verify that they expose the current teardown behavior.
- [x] Separate temporary socket suspension from explicit room cleanup; gate sending and network controls during resynchronization.
- [x] Merge the Emoji and Emotes tabs; add bounded rendering and cross-pack search.
- [x] Test and implement colon token detection, caret-aware replacement, keyboard selection, Escape dismissal, and IME preservation.
- [x] Expand verified human-made packs to at least 1,000 selectable emoji entries; record source, license, attribution, and checksums. Include noncommercial packs only with verified author permission under the approved personal-use constraint.
- [x] Expand the curated GIF collection to 200 real, verified entries with additional cat reactions. Preserve provider attribution and ID-only messaging; do not invent a live-search API key or assume permission to redistribute copyrighted packs.
- [x] Run focused and full tests, both TypeScript checks, the production build, and whitespace checks.
- [x] Review the implementation for specification compliance and code quality; fix findings.
- [x] Verify reconnect behavior, autocomplete, artwork, and picker geometry in desktop and mobile browsers; provide a working local preview.

## Final Verification

Application tests: 156 passing across 10 files. Importer restoration tests: 21
passing. Both TypeScript configurations, production build, whitespace checks,
and Wrangler deployment dry run pass. The build retains a non-blocking client
chunk-size warning (approximately 671 KB raw / 142 KB gzip).

Chromium verified two real room WebSocket clients, retained iframe/composer
identity using a stubbed YouTube API, retained text and GIF drafts, fresh-session
history invalidation, offline controls, caret autocomplete and keyboard behavior,
Neocat image pixels, local GIF rendering/pagination, and six viewport sizes.

The final searchable GIF catalog is 200 licensed, locally hosted Animated Noto
GIFs. The proposed GIPHY index was replaced following provider-terms review;
character-specific GIPHY search remains a separate optional API integration.

## Acceptance And Privacy

History is authoritative only after an authenticated server snapshot. Temporary disconnects must not replay uncertain sends or allow pre-snapshot live messages to mutate stale history. When everyone has left, the server's new session invalidates old displayed history on reconnection. Explicit departure clears the room cache while retaining the chosen display name. No AI-generated emote artwork, unclear-license Pepe redistribution, production deployment, or commits are part of this change.

## Delivery And Rollback

Keep this working plan uncommitted. Existing dirty changes belong to the user and must remain intact. No storage migration is required: existing shortcodes, GIF IDs, and room protocol remain compatible. Rollback should remove only this task's changes, preserving earlier uncommitted work.
