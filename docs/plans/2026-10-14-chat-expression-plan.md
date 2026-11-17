# Chat Expression Implementation Plan

## Final Execution Status

Implementation and review completed on 2026-10-14. All 128 tests, both TypeScript
checks, production build and diff checks pass. Admin/viewer browser checks pass
at five widths; short-screen picker geometry passes at 390x568, 320x568 and
768x500. All 24 original emotes render nonblank pixels and all 36 curated GIFs
load. Live provider API flows are mock-verified; keyless curated behavior is
browser-verified. Independent final review reports no blocking findings.
See `2026-10-14-chat-expression-handoff.md` for final behavior and verification;
the task checkboxes below retain intermediate execution notes.

> **For agentic workers:** Use executing-plans for remaining work. Main agent owns execution; this document records current status rather than repeating completed implementation tasks.

**Goal:** Searchable original emotes, keyless curated GIFs, optional direct GIPHY search and safe consecutive-message grouping.

**Architecture:** Preserve curated GIF shapes and exact legacy URLs. Live API response URLs remain transient browser state; messages/recents carry IDs only. The Worker validates IDs without fetching GIPHY and assigns random sender IDs per authenticated socket.

**Tech Stack:** Existing React/TypeScript, Vite, Cloudflare Workers and Vitest.

**Design:** [Approved design](2026-10-14-chat-expression-design.md). Keep both documents uncommitted; configuration and deployment remain unchanged.

## Current Contracts

- `src/stream/chat-media.ts` exports `searchChatMedia`; `ChatPicker.tsx` already imports it correctly. Keep this location/import, with no circular re-exports or duplicate helper.
- `src/stream/chat-emotes.ts`: `ChatEmote { id, label, url, aliases, tags }`, catalog lookup and `tokenizeChatEmotes`. Shortcodes derive from IDs; categories use tags.
- `src/client/lib/emojiSearch.ts`: named subject/mood and literal-glyph queries through `searchEmoji`.
- `src/client/lib/chatGrouping.ts`: `continuesChatGroup`. `mediaRecents.ts`: `readMediaRecents`/`rememberMedia`, bounded ID strings.
- `src/client/components/ChatGifImage.tsx` owns the raw-URL helper `ChatGifImage({ url, label, onRetry? })`. Picker imports and re-exports it; attachment imports it directly. Preserve this dependency direction.
- `ChatGifAttachment.tsx` accepts `{ id: string }`, renders curated URLs without a key, and freshly resolves only live provider IDs through browser `giphy.ts`. Raw image inputs are curated or provider-validated only.
- Keep curated `.url`, exact legacy embeds and keyless previews. Live API URLs never persist. Public `VITE_GIPHY_API_KEY` is build-time only; no Worker fetch, configuration endpoint or server verification.

## Completed

Status and counts below use main-agent test evidence; overlapping runs are not an additive full-suite total.

- [x] Identity and identifier validation complete: per-authenticated-socket UUID, forged identity ignored, legacy history compatibility and cleanup. Backend: 48 tests passing.
- [x] Grouping complete: adjacent matching sender/name/session only, legacy messages ungrouped, accessible per-message metadata.
- [x] Recents complete: bounded, deduplicated identifier-only storage and guarded reads/writes.
- [x] Composer/client integration: 32 tests passing.
- [x] Search/attachment hook coverage: 11 tests passing.
- [x] Combined client-library and hook coverage: 21 tests passing.
- [x] Both source reviews approved; all findings resolved.
- [x] Correct search imports, dedicated image-helper module and named emoji search are present. No export migration or repeated implementation is needed.

## Remaining Verification

- [ ] Finish/verify catalog assets against design: at least 24 original SVG emotes and 36 handpicked GIFs, preserving all 12 legacy URLs. Check actual nonblank assets, provenance and keyless previews rather than inferring completion from metadata.
- [ ] After catalog/assets are ready, run `npm test -- --run`, `npx tsc --noEmit -p tsconfig.json`, `npx tsc --noEmit -p test/tsconfig.json` and `npm run build`. These final integration gates are separate from the passing focused runs above.
- [ ] Final browser QA remains pending. Use the existing dev workflow on an available port; check `/` and `/admin` at desktop/mobile widths, keyboard/focus, inline assets, named search/categories/recents, keyless curated previews/sends, provider errors/retry, grouping, reduced motion and rejected drafts.
- [ ] Verify browser network/storage: direct provider requests, unchanged curated URLs, no persisted API media URLs; report real-key vs mocked live-provider coverage.
- [ ] Final handoff records integration/browser results and any unverified assets. Keep docs uncommitted and exclude the unrelated chat-delay investigation.
