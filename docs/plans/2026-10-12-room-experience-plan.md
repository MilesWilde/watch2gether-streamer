# Room Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Track steps using the checkboxes below.

**Goal:** Prioritize the responsive 16:9 player, add authenticated transient synchronized chat, and preserve shared playback speed.
**Architecture:** Keep React/Vite and the existing non-hibernating Durable Object sockets. Chat lives only in room memory; authenticated snapshots authorize client history and localStorage caching. Playback rate remains in the existing persisted playback state.
**Tech Stack:** TypeScript, React 19, Vite 8, Cloudflare Workers/Durable Objects, Vitest 4 and Workers pool 0.18.

## Execution Status
- [x] Baseline work committed as ec35a7b; feature branch improve-room-layout-chat created.
- [x] Backend chat protocol, session lifecycle, Unicode validation, media catalog, and speed transitions implemented; specification review passed.
- [x] Responsive layout, chat UI, browser cache, names, picker, and socket lifecycle implemented; specification review passed.
- [x] Iframe speed restoration and advancement guard implemented; specification and code-quality reviews passed.
- [x] Final combined suite: 85 tests passed. Application and test TypeScript checks, production build, and whitespace checks passed.
- [x] Live room tests and two-browser synchronization, GIF loading, long emoji messages, rejoin retention, and empty-room invalidation passed.
- [x] Admin and viewer browser layout checks passed at 1440, 1024, 768, 390, and 320 pixels without horizontal overflow.
- [x] Final integrated code-quality review and local PR-ready handoff.
- [x] Preserve text and GIF drafts until correlated server delivery acknowledgment; retain rejected drafts and cover rate-limit rejection.
- [x] Save the implementation as a separate local commit, 87e1d49, with working design and plan notes excluded.

The task details below record the initial implementation guidance. The shared contract and execution status above reflect the delivered implementation; actual test files are test/backend-protocol.test.ts, test/backend-room.test.ts, test/chat-storage.test.ts, test/chat-storage-socket.test.ts, and test/player-rate-hook.test.ts, all run by the configured Workers test suite without additional DOM dependencies.

## Constraints And Baseline
- Design: `docs/plans/2026-10-12-room-experience-design.md`; baseline `ec35a7b`; existing branch `improve-room-layout-chat` and checkout.
- Implementation is already authorized; no additional human phase checkpoints. Do not commit any files, including `docs/plans/`.
- Preserve playlist import, authentication, volume/fullscreen, existing styling, unrelated changes, and hosting. No Durable Object migration or chat persistence.
- Follow strict `tsconfig.json`, tab/LF `.editorconfig`, and `.prettierrc` (tabs, single quotes, semicolons, printWidth 140). Avoid unrelated formatting churn.
- Main coordinates `lucide-react` dependency and browser availability. Do not duplicate dependency edits across workers.

## Shared Contract (Agree Before Parallel Edits)
- Create `src/stream/chat.ts`: `ChatMessage = { id: string; sessionId: string; name: string; text: string; gifId?: string; sentAtMs: number }`; `ChatSnapshot = { sessionId: string; messages: ChatMessage[] }`.
- Client messages: `authenticate` with optional `name`, `{ type: "set_name"; name: string }`, and `{ type: "send_chat"; text: string; gifId?: string }`. Server messages: `{ type: "chat_history"; chat: ChatSnapshot }`, `{ type: "chat_message"; message: ChatMessage }`, and `{ type: "name_updated"; name: string }`.
- Server assigns IDs, session, monotonically increasing sequence and timestamps. Never trust client-supplied identity, sequence, session or asset URLs; display names are preferences, not verified identities.
- Limits: export MAX_CHAT_NAME_LENGTH=40, MAX_CHAT_MESSAGE_LENGTH=2000, MAX_CHAT_MESSAGES=500. Preserve Unicode emoji. Reject blank text unless a valid GIF exists.
- Retain the latest 500 messages per session on server and client. Validate all GIF IDs through the shared catalog; render text as React text nodes, never HTML or auto-embedded URLs.
- Create `src/stream/chat-media.ts`: shared static catalog CHAT_EMOJI with at least 60 emoji and CHAT_GIFS with at least 12 cute GIFs, each with id, label and fixed allowlisted URL. Export getChatGif(id). No API key, search API or user-provided media URL. Verify actual asset loading in browser QA.
- After successful authentication send `authenticated`, existing `state`, then `chat_history`. Only authenticated sockets receive chat/history. Client requires both authentication and a validated snapshot for the current connection before rendering messages or enabling send.
- Immediately rotate session ID and clear history when authenticated socket count reaches zero, synchronously before asynchronous playback persistence. Unauthenticated sockets do not keep history alive. Constructor starts a fresh session; never read/write chat in Durable Object storage.
- Cache key `watchparty-chat:global`, envelope `{ version: 1; sessionId: string; messages: ChatMessage[] }`; separate saved-name key `watchparty-display-name:global`. `/` and `/admin` share the existing global room.
- Server snapshot always replaces cached messages, even for a matching session; mismatched/malformed cache is removed. No cache hydration or stale-history flash before confirmation. Deduplicate live IDs/sequences, enforce session match and bounded retention.
- Explicit Leave disables reconnect, closes the socket, clears rendered chat and chat cache, and preserves the saved name. Disconnect hides history and clears cache until a new authenticated snapshot.
- Add optional error code `"authentication" | "authorization" | "validation"` to server errors. Authentication failures and `Not authenticated` clear socket auth; validation/permission errors preserve authentication and ping. Keep legacy password-error classification for compatibility.

## Task 1: Backend Protocol, Chat Lifecycle, Playback State
**Owner:** Backend worker; owns shared contract and Workers test configuration. Land contract definitions before UI consumes them.
**Modify:** `src/stream/messages.ts`, `src/stream/playlist.ts`, `src/stream-room.ts`, `vitest.config.mts`, `test/env.d.ts`, `test/tsconfig.json` if type resolution requires it.
**Create:** `src/stream/chat.ts`, `src/stream/chat-assets.ts`, `test/messages.test.ts`, `test/playlist.test.ts`, `test/stream-room.test.ts`, `test/helpers/roomSocket.ts`.
- [ ] Replace obsolete `defineWorkersConfig`/`poolOptions` with `defineConfig` from `vitest/config` and plugin `cloudflareTest` from `@cloudflare/vitest-pool-workers`.
- [ ] Configure `cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { ROOM_PASSWORD: "test-viewer", ADMIN_PASSWORD: "test-admin" } } })`; include `test/messages.test.ts`, `test/playlist.test.ts`, `test/stream-room.test.ts` explicitly. Never read or publish real passwords in tests.
- [ ] Write parser tests: emoji name accepted; malformed JSON/types, blank name, 33-code-point name, 1001-code-point text, empty payload and unknown GIF rejected; GIF-only accepted; arbitrary URL cannot become a GIF.
- [ ] Write speed regression tests at 1.5x: next/wrap/empty-next, remove current/last/before current/after current; verify stopped position and playing semantics remain unchanged and rate stays 1.5.
- [ ] Run `npx vitest run test/messages.test.ts test/playlist.test.ts`; require targeted failures before implementation, not configuration failure.
- [ ] Make `createStoppedPlaybackState(playbackRate = 1)` preserve normalized supplied rate; pass prior rate from every branch of `moveToNextPlaylistItem` and `removePlaylistItem`. Preserve rate in `StreamRoom.clearRoom`; manual switching already preserves it and needs regression coverage.
- [ ] Extend parser/unions/errors and add bounded in-memory chat state to `StreamRoom`. Authenticate sends snapshot; `send_chat` uses `requireAuthenticated`, assigns metadata and broadcasts synchronously. Disconnect/reset is idempotent for close, error and failed-send paths; duplicate authenticate must not reset history or inflate presence.
- [ ] Integration tests use actual upgraded WebSockets via `env.STREAM.getByName(uniqueTestName).fetch(...)`; register message listeners before authenticate/send, accept client sockets, await protocol messages with bounded timeouts, close all sockets in cleanup. Use `env` from `cloudflare:workers`; use `cloudflare:test` reset/eviction helpers supported by installed types.
- [ ] Test unauthenticated send/receive exclusion, both authenticated roles, identical ordered delivery to two sockets, snapshot on third/rejoin, retained history after one departure, reset on final departure despite an unauthenticated socket, repeated close/error cleanup and 200-message bound.
- [ ] Test invalid chat and viewer admin command errors do not remove backend authentication. Test current-item removal, manual play, next and clear retain selected rate via WebSocket state messages; viewer cannot change shared rate.
- [ ] Test restart using `evictDurableObject(stub, { webSockets: "close" })`: reconnect gets a new empty chat session while persisted playlist/rate survives. Assert durable storage contains no chat history/session keys.
- [ ] Run `npx vitest run test/messages.test.ts test/playlist.test.ts test/stream-room.test.ts`; all pass with no hanging sockets or unhandled promises.

## Task 2: Client Chat, Cache, Picker And Responsive Layout
**Owner:** UI worker; consumes shared contract, does not edit Task 1 files.
**Modify:** `src/client/WatchPartyApp.tsx`, `src/client/hooks/useWatchPartySocket.ts`, `src/client/components/RoomHeader.tsx`, `src/client/components/PlayerPanel.tsx`, `src/client/components/RequestVideoPanel.tsx`, `src/client/components/RequestsPanel.tsx`, `src/client/components/PlaylistPanel.tsx`, `public/styles.css`.
**Create:** `src/client/lib/chatCache.ts`, `src/client/lib/chatSession.ts`, `src/client/hooks/useRoomChat.ts`, `src/client/components/ChatPanel.tsx`, `src/client/components/ChatPicker.tsx`, `public/chat-gifs/` assets/provenance, `vitest.client.config.mts`, `test/client/chatCache.test.ts`, `test/client/chatSession.test.ts`, `test/client/socket.test.tsx`, `test/client/chatPanel.test.tsx`.
- [ ] Pure cache API: `readChatCache(storage: Storage): ChatSnapshot | null`, `writeChatCache(storage: Storage, snapshot: ChatSnapshot): void`, `clearChatCache(storage: Storage): void`, plus separate saved-name read/write. Catch unavailable storage, quota failures and invalid JSON; validate schema/messages/limits before accepting cache.
- [ ] Pure session reducer owns authenticated/snapshot-ready state, snapshot replacement and live-message append/dedupe. `useRoomChat` connects reducer to storage/UI; stable callbacks must not reconnect sockets on each message/name edit.
- [ ] Write tests before implementation: cache invisible before auth/snapshot; same-session authoritative snapshot trims/replaces cache; new session removes stale entries; disconnect/reconnect gate; wrong-session live messages ignored; duplicate IDs/sequences ignored; malformed/oversized cache and throwing storage safe; Leave clears messages/cache but keeps emoji name.
- [ ] Client tests use `defineConfig` with Node pool and `test/client/**/*.test.{ts,tsx}`; DOM test files use jsdom environment and React `act`/`createRoot`. Coordinate needed jsdom dependency with main; Workers config must exclude client tests. Extend `test/tsconfig.json` include to TSX as needed under backend/main ownership.
- [ ] Move/export server parser for testing if needed within socket hook ownership; validate new chat payloads at runtime, not through type casts alone. Error code/classification controls auth loss; ordinary errors still reach app status without stopping ping/reconnect behavior.
- [ ] Expose socket `leave(): void` to immediately stop timers, mark connection disposed, close socket and clear auth; app also sets `sessionRequested=false`. Guard late events from old/disposed sockets to prevent cache repopulation or reconnect after Leave.
- [ ] Add saved editable display name, bounded independently scrolling message log, labelled composer, pending-snapshot/connection-disabled send state, text or GIF sending, and inline validation errors. Avoid optimistic unconfirmed messages; keep draft until send is accepted locally or retain it on unavailable socket.
- [ ] Picker uses shared catalog: emoji insert at caret, GIF selection sends catalog ID; labelled tabs, icon trigger with tooltip/aria-expanded, Escape/outside dismissal, focus restoration, keyboard navigation, bounded mobile dimensions. GIFs have alt labels, stable dimensions, lazy loading and reduced-motion fallback. Verify every curated asset actually animates/loads and has usable licensing.
- [ ] Reorganize app into unframed player/chat top row and support panels below. Add a scoped `room-panel` class to request/playlist sections to remove floating card treatment without changing auth/import-modal styling. Metadata belongs below video, not a width-consuming column.
- [ ] CSS starting rules: shell max-width 1440px; wide top grid `minmax(0, 1fr) minmax(280px, 320px)`; below 1100px one column with full-width player/chat; support grid two columns above 640px and one below. Keep `aspect-ratio:16/9`, `min-width:0`, wrapping controls/actions and `overflow-wrap:anywhere`.
- [ ] On narrow screens remove horizontal shell/player padding around video so it uses 100% available content width; pad surrounding controls separately. Bound chat height (e.g. 24rem) and picker to viewport; shrink volume control minimum width. Do not hide overflow to mask broken layout or use viewport-scaled font sizes.
- [ ] Run `npx vitest run --config vitest.client.config.mts`; assert DOM tests preserve auth after validation/authorization errors, close on Leave, ignore late events, render HTML-looking text literally, preserve emoji names, and allow keyboard picker dismissal.

## Task 3: YouTube Rate Restoration And Integration
**Owner:** Player worker; no app/CSS/backend edits. Starts independently using current playback contract.
**Modify:** `src/client/hooks/useYouTubePlayer.ts`, `src/client/types/youtube.d.ts`.
**Create:** `test/client/youtubePlayer.test.tsx` (uses Task 2 client config and coordinated DOM dependency).
- [ ] Build a fake `YT.Player` that captures configured callbacks, resets its rate to 1 on cue/load, and records `setPlaybackRate`, seek/play/pause and outgoing messages. Write failing hook regressions before changing events.
- [ ] Add `CUED` to declared `YT.PlayerState`. Extract a rate-only callback reading `latestStateRef.current.playback.playbackRate`; apply on CUED and PLAYING before role/suppression guards. This path must bypass `lastAppliedPlaybackKeyRef` and must not seek/play/pause or emit shared updates.
- [ ] Keep full playback-state dedupe and admin event suppression intact. Reapplying rate must work for viewers and admins during suppression windows; it must use the latest selected rate, not a captured render value.
- [ ] Test load and cue at 1.5x followed by simulated iframe reset; identical playback key still restores rate; subsequent selection of 2x uses 2x; viewers emit no playback commands; CUED causes no feedback; ENDED still advances once and supported-rate fallback does not change server preference.
- [ ] Run `npx vitest run --config vitest.client.config.mts test/client/youtubePlayer.test.tsx`; pass, then integrate with Task 1 transitions and Task 2 layout/chat.

## Final Validation And Review (Main)
- [ ] Run `npx vitest run`, `npx vitest run --config vitest.client.config.mts`, `npx tsc --noEmit`, `npx tsc --noEmit -p test/tsconfig.json`, `npm run build`; record actual results, distinguish runtime/config limitations from feature failures. No configured lint script exists; avoid unrelated lint setup.
- [ ] If browser available, start `npm run dev -- --port 8788` on an unused port; use separate authenticated viewer/admin contexts. Because dev builds once before Wrangler, rebuild/restart after client changes. Stop validation servers after QA unless intentionally handing one to user.
- [ ] Browser QA at 1440x900, 1024x768, 768x1024, 390x844 and 320x568: capture screenshots; assert document scrollWidth <= clientWidth, video nonblank/visible and 16:9, narrow video fills available width, panels reflow, controls/picker/text do not overlap, chat scrolls independently, import modal remains usable.
- [ ] Cross-context QA: message/GIF/emoji name sync; Leave/rejoin while another stays retains history; all Leave then rejoin gets new empty session and stale cache never flashes; saved name survives; validation errors keep socket authenticated. Test speed across next, ended, manual switch, remove current and clear/refill on admin and viewer.
- [ ] Run spec review against design/ticket and code-quality review of actual diff; fix findings, rerun affected checks. Check `git diff --check`, `git diff --stat`, `git status --short`; docs stay uncommitted, secrets/generated build output and unrelated changes excluded from feature handoff.

## Risks And Rollback
- Zero-socket reset must occur before awaits and count only authenticated sockets; failed broadcasts/duplicate disconnects can trigger it. Test last-close and restart with real socket lifecycle, not only pure helpers.
- Cache gating and old-socket events are privacy risks; server snapshots are always authoritative. localStorage is only a bounded convenience cache, not a durable transcript or trusted identity.
- GIF licensing/loading and YouTube iframe behavior require asset/browser checks; mocks cannot prove animation, playback compatibility or responsive framing. Record unavailable browser QA explicitly in handoff.
- Installed Workers pool exports `cloudflareTest`, not `/config`; harness migration is prerequisite, not an optional cleanup. Runtime startup failures must not be presented as passing lifecycle coverage.
- No storage schema migration: existing playlist/playback storage remains compatible. Chat/session/cache are intentionally disposable. Roll back only this feature's reviewed edits/assets and coordinated dependency changes; preserve user work and working docs. Do not use destructive checkout/reset or commit without a new request.
- Future authorized deployment rollback restores the previous Worker and client bundle together; restart discards chat and clients must reauthenticate. Remove only `watchparty-chat:global` cache if needed; retain the separately saved name.
