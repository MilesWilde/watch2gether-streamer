# Robot Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans task-by-task. Main owns integration; one frontend worker owns the editor, avatar, CSS and editor tests. Use specification and code-quality review before handoff.

**Goal:** Build the approved local robot-head profile editor and share acknowledged names, avatars and name colors in future room-message headers.

**Architecture:** Reuse `src/stream/chat-profile.ts` as the sole allowlisted scalar contract. The server owns each authenticated socket's profile and copies it onto messages; clients render locally and persist preferences only after acknowledgement. Legacy messages use the default robot; history is never rewritten.

**Tech Stack:** React 19, TypeScript, local DiceBear core/Bottts pinned to patched `9.4.3`, lucide-react, Vitest with the existing Workers pool, Vite and Playwright browser checks.

## Scope and Ownership

- Work in `/home/craig/projects/watch2gether-stream`; preserve the existing dirty worktree and other agents' changes. This working plan stays uncommitted. No publishing, migrations, external secrets or unrelated refactors.
- Main modifies `src/stream/chat-profile.ts`, `src/stream/chat.ts`, `src/stream/messages.ts`, `src/stream-room.ts`, `src/client/lib/chatStorage.ts`, `src/client/lib/chatGrouping.ts`, `src/client/hooks/useRoomChat.ts`, `src/client/hooks/useWatchPartySocket.ts`, `src/client/components/ChatPanel.tsx`, `src/client/WatchPartyApp.tsx`.
- Main creates `src/client/lib/profileStorage.ts`; extends `test/chat-profile.test.ts`, `test/backend-protocol.test.ts`, `test/backend-room.test.ts`, `test/chat-storage.test.ts`, `test/chat-storage-socket.test.ts`; owns any required `package.json`/`package-lock.json` changes. Grouping coverage belongs in the actual `test/chat-storage-socket.test.ts` integration harness.
- Frontend worker owns `src/client/components/ChatProfileEditor.tsx`, `src/client/components/RobotAvatar.tsx`, `src/client/lib/robotAvatar.ts`, `test/profile-editor.test.ts` and `test/robot-avatar.test.ts`; modifies only profile/avatar rules in `public/styles.css`. Main owns `public/avatars/BOTTTS-LICENSE.txt` and shared integration files.
- Exact editor API: `ChatProfileEditor({ name, profile, ready, onSave, onClose, triggerRef? })`, with `onSave: (name: string, profile: ChatProfile) => boolean`. ChatPanel conditionally mounts it; the editor calls `onClose` when `onSave` queues successfully (`true`), following the existing name-editor pattern. A `false` result retains the draft. Persistence still requires a server acknowledgement; no pending UI, acknowledgement matching, new wire state or save timeouts.

## Progress

All stages are complete. The final tree passes 315 tests in 18 files, application
and test TypeScript checks, production build, and profile/reconnect/picker/import
browser suites. Production dependency audit reports zero vulnerabilities.
Specification and quality reviews are clear after cache projection, accessible
selector-label and per-avatar memoization fixes. The 129-avatar regression
confirms repeated and equivalent-profile renders do not regenerate SVGs.

## 1. Shared Contract: Main, TDD

- [x] Extend `test/chat-profile.test.ts` with malformed/missing scalar, getter, inherited-field, extra-field projection and per-field equality cases. Keep the existing parser semantics: unknown keys are stripped, never propagated; invalid required choices reject the profile.
- [x] Run `npm test -- --run test/chat-profile.test.ts`; observe new behavior assertions fail before implementation, while existing parser tests stay green.
- [x] Preserve the eight existing fields and palettes; compare all allowlisted values for grouping with absent profiles resolved to fresh defaults. Main may export `chatProfilesEqual` from the model if useful; keep its definition, imports and tests consistent rather than requiring a new helper API. Add `profile?: ChatProfile` to `ChatMessage` in `src/stream/chat.ts`.
- [x] Rerun the focused suite; expect PASS. Continue using `normalizeChatName`, NFC normalization and `Array.from(name).length` for the 40-code-point limit, including emoji; never use UTF-16 `maxLength` as the authority.

## 2. Protocol and Room Authority: Main, TDD

- [x] Add parser tests in `test/backend-protocol.test.ts`: legacy authenticate/set_name, valid optional authenticate profile, invalid supplied profile rejection, normalized `set_profile` name/profile, and `send_chat` dropping spoofed name/profile fields.
- [x] Add room tests in `test/backend-room.test.ts`: authentication required; independent two-socket profiles; default robot on legacy auth; private `name_updated` acknowledgements containing name/profile on auth, set_profile and set_name; future-message snapshots; unchanged history; legacy rename preserving avatar; disconnect cleanup and reconnect restoration via authenticate. Verify existing clients can consume the same acknowledgement type and ignore its extra field.
- [x] Run `npm test -- --run test/backend-protocol.test.ts test/backend-room.test.ts`; confirm new protocol/room cases fail for the intended missing behavior.
- [x] In `src/stream/messages.ts`, extend authenticate with optional parsed profile; add `{ type: 'set_profile', name: string, profile: ChatProfile }` to `ClientMessage` and extend the existing acknowledgement to `{ type: 'name_updated', name: string, profile?: ChatProfile }`. Reuse this message type exclusively. Reject malformed supplied profiles; omission on authenticate alone selects the legacy default.
- [x] In `src/stream-room.ts`, add `socketProfiles: Map<WebSocket, ChatProfile>`; initialize only on successful authentication and apply normalized name plus parsed profile atomically on authenticated `set_profile`. Always send the authoritative `{ type: 'name_updated', name, profile }` privately on auth (after `authenticated`), set_profile and set_name; old clients ignore the extra field.
- [x] Preserve authenticated `set_name`; change only the name and include the unchanged profile in its `name_updated` acknowledgement. Snapshot a fresh scalar profile alongside name in `sendChat`, ignore send payload identity, delete the map entry on socket removal, and leave existing stored messages untouched.
- [x] Rerun both focused suites; expect PASS, including request IDs, flood limits, session boundaries and existing authentication regressions.

## 3. Storage and Socket Lifecycle: Main, TDD

- [x] Extend `test/chat-storage.test.ts` for optional valid cached profiles, legacy cache, invalid profile rejection, projected preferences, malformed/oversized storage, blocked storage and independent defaults. Extend `test/chat-storage-socket.test.ts` using its existing deterministic hook/socket harness for acknowledgements, leave, reconnect and rerender behavior.
- [x] Assert no preference writes before auth or on dispatch/rejection/disconnect; an authenticated `name_updated` with a valid profile saves the authoritative pair. A legacy name-only acknowledgement persists only the name and retains the current/stored profile; malformed supplied profiles reject the acknowledgement. Assert a profile-only rerender creates zero extra sockets and the next reconnect authenticates with the latest acknowledged profile.
- [x] Run `npm test -- --run test/chat-storage.test.ts test/chat-storage-socket.test.ts`; observe new cases fail before implementing them.
- [x] Implement profile preference reads/writes in the independent `src/client/lib/profileStorage.ts`, not `chatStorage.ts`: use `watchparty-chat-profile:global`, bounded version-1 `{ version: 1, profile }` envelopes, projection through `parseChatProfile`, safe defaults and caught storage failures. Keep optional cached-message profile validation in `chatStorage.ts` without rejecting legacy messages; persist no SVG, data URLs or remote avatar URLs.
- [x] In `useRoomChat.ts`, initialize/expose `profile`; process authenticated `name_updated` using the existing acknowledgement branch. Persist its name; update/persist profile only when `ack.profile` exists and passes `parseChatProfile`, using the projected value. Legacy name-only acknowledgements never reset or write profile. `clear` removes chat cache, never either profile preference; `suspend` retains both.
- [x] In `useWatchPartySocket.ts`, add `preferredProfile?: ChatProfile` and extend runtime `name_updated` validation to accept absent profiles or valid projected profiles, rejecting malformed supplied values. Read the latest profile through `optionsRef.current` on authenticate; do not add name/profile/options objects to connection-effect dependencies. Reject malformed profile-bearing history/live messages through shared cache validation.
- [x] Rerun focused tests; expect PASS for pre-auth rejection, legacy acknowledgements, reconnect history deduplication, preference retention and no reconnect on profile updates.

## 4. Local Avatar and Editor: Frontend Worker, TDD

- [x] Write `test/profile-editor.test.ts` using existing Vitest React-hook/element conventions: every selector/swatches changes a valid draft, Randomize stays allowlisted, 40 emoji code points succeed/41 fail, Cancel discards, Save dispatches once, `onSave` returning true closes immediately, and returning false retains edits. Test deterministic avatar output and all offered part options, especially `top/sides: 'none'`.
- [x] Run `npm test -- --run test/profile-editor.test.ts`; observe missing editor/renderer failures, then implement the worker-owned files.
- [x] In `robotAvatar.ts`, parse/project input and render only with bundled `@dicebear/core`/`@dicebear/bottts`; map each selected part to a singleton option, disable random alternatives, set optional-part probability to 0 for `none` and 100 otherwise, and apply selected robot/background colors. Export `robotAvatarDataUri(profile: ChatProfile): string`; no fetches or untrusted SVG insertion.
- [x] In `RobotAvatar.tsx`, use a fixed-dimension local generated image with decorative empty alt when a visible name accompanies it. In `ChatProfileEditor.tsx`, show the robot-head/name live preview, face/eyes/mouth/top/sides selectors, icon-only robot/background/name-color swatches with tooltips and aria-labels, and Randomize; randomization preserves the name. Swatches use eight per row on desktop and four on mobile to reduce dialog height.
- [x] Implement a compact accessible modal around 440px wide, `max-width: calc(100vw - 24px)`, bounded to `calc(100dvh - 24px)`, with an internally scrolling controls area and reachable actions. Include focus trap/return via optional `triggerRef`, Escape/Cancel, body-scroll cleanup, Lucide icon tooltips, keyboard-operable swatches and readiness/validation feedback; no nested decorative cards or pending-save state.
- [x] Rerun worker tests; expect PASS. Hand main the exact API and test results; main reviews the actual owned diff before integration.

## 5. Wiring, Headers and Attribution: Main, TDD

- [x] Extend grouping tests in `test/chat-storage-socket.test.ts`: equal profile copies continue a group, any changed field breaks it, absent/default profiles compare equal, and existing sender/name/session conditions remain mandatory. Extend the app/panel harness for editor dispatch, immediate close on successful queueing, failed queue retaining edits, acknowledgement-only persistence and historical headers.
- [x] Run `npm test -- --run test/chat-storage-socket.test.ts`; observe expected new assertion failures.
- [x] Wire `WatchPartyApp.tsx` with `preferredProfile: chat.profile`; pass profile and `onProfileChange` through `ChatPanel.tsx`, dispatching `set_profile`. Replace inline name editing with conditionally mounted `ChatProfileEditor` using its exact API and the existing queue-result close pattern; leave profile state/storage changes to the server `name_updated.profile` acknowledgement.
- [x] Render each visible message header with `RobotAvatar` and its snapshotted allowlisted name color; legacy messages resolve to default robot/color. Compare profile values in `chatGrouping.ts`, optionally using main's exported helper; never substitute today's preferred profile into old messages or mutate chat history.
- [x] Confirm both dependencies remain exactly `9.4.3` in manifest/lockfile. Review the frontend worker's `public/avatars/BOTTTS-LICENSE.txt` with installed MIT code notices and Bottts artwork's free personal/commercial-use terms and Pablo Stanley credit; link that actual local credit path from the editor. Preserve package-provided license wording.
- [x] Rerun focused integration tests; expect PASS. Review specification compliance and code quality separately; fix findings and rerun affected tests.

## 6. Final Checks and Browser Acceptance

Browser QA passes local artwork pixel checks, selectors/colors, Cancel/Randomize,
two-client names/avatars/grouping and unchanged history, reconnect/reload/rejoin,
offline editing, keyboard focus, responsive viewports, local license and no
avatar network calls. Final post-performance build passes; Vite retains its
existing large-bundle advisory.

- [x] Run `npm test -- --run`, `npx tsc --noEmit`, `npx tsc -p test/tsconfig.json`, and `npm run build`; require all to pass and record any existing build advisory separately.
- [x] Use the existing local preview or start `npm run dev -- --port <free-port>` for QA. With Playwright at desktop 1440x900 and mobile 390x844/320x568, inspect screenshots: visible robot parts, swatch/name updates, bounded dialog, internal scrolling, reachable actions, no overlap/horizontal overflow, keyboard focus/Escape/return and nonblank generated-avatar pixels.
- [x] In two browser contexts, send before/after changing every profile dimension and name; both clients must see the new future header, a new consecutive group, and unchanged older headers. Verify ordinary same-profile grouping and default legacy history.
- [x] Complete final persistence acceptance (browser lifecycle/offline/no-avatar-call checks already PASS): verify Save closes immediately when queueing succeeds and a failed queue retains edits; dispatch alone never persists profile. Only a valid authenticated `name_updated.profile` updates profile preferences; a name-only acknowledgement leaves profile unchanged. Reconnect uses the acknowledged profile without a save-triggered connection restart; leave/rejoin and full reload retain preferences while respecting existing chat-cache/session rules. Confirm no avatar network requests or raw SVG/URLs in saved profile data.
- [x] Regression-check chat send acknowledgement/failure, emoji/autocomplete, GIF picker/send, scrolling/unread notifications, playback, room authentication and playlist controls. Record browser evidence and final review findings; keep delivery local and this plan uncommitted.

## Local Handoff

Preview: `http://localhost:8793/`, QA password `qa-viewer`; admin uses `qa-admin`.
Screenshots and reproducible browser scripts are under `/tmp/watchparty-robot-*`.

Proposed PR title: Add customizable robot chat profiles

Proposed body: Add a compact Bottts profile editor with parts, colors and local
preview; persist acknowledged preferences and share server-owned appearance
snapshots in chat. Keep legacy profiles, reconnects, grouping and notifications
compatible. Verified with 315 tests, both TypeScript checks, production build,
production dependency audit and desktop/mobile browser suites.
