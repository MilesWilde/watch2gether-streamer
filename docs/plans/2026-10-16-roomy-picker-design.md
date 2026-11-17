# Roomy Picker Design

Status: user-approved design; local work remains uncommitted.

## Experience

The picker becomes a viewport overlay with an explicit close control, focus trap,
focus restoration, and body scroll lock. Near-bottom scrolling automatically
appends 96 emoji or 48 GIFs. Each tab remembers its own query, mood/category,
pack, source, visible count, and numeric scroll offset when reopened.

## Ownership

Main owns the mounted picker component, overlay accessibility, CSS, scroll
restoration, and persistence flushes on close, pagehide, and unmount. Another
agent owns the infinite Giphy provider hook: separate requests and live results
remain memory-only. This sidecar owns only the state module, its unit tests, and
these two planning documents.

## Reload Fallback

`createPickerState`, `readPickerState`, and `writePickerState` share the requested
`ChatPickerState` / `PickerView` API. Persistence uses
`watchparty-chat-picker:global` with a top-level `version: 1`, `tab`, `emoji`, and
`gif`. Defaults select emoji, empty queries, all categories/packs, collection
source, counts 96/48, and zero offsets. Every call creates independent views.

Only allowlisted preferences, counts, and numeric offsets are serialized. No
provider result objects, GIF URLs, or message content are retained. Queries are
limited to 50 UTF-16 code units; positive integer counts to 5000; finite offsets
to 0..1000000. Invalid fields revert individually to their defaults. Unknown
versions, malformed JSON, and raw payloads over 4096 code units reset entirely.
Storage failures and throwing property accessors must not interrupt chat.

Accepted packs: all, unicode, openmoji, twemoji, neocat. Accepted categories:
all, recent, happy, love, chaotic, sad, cozy, funny. Sources: collection, giphy.

## Verification

Focused Vitest coverage checks initial counts first, reload round trips,
independent defaults, strict field validation, numeric boundaries, hostile
storage/accessors, oversized payloads, and exclusion of extra content.
