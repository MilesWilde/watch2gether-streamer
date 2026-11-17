# Expressive chat picker and consecutive-message grouping

## Approved scope

Expand room chat with Discord-style custom image emotes, more varied GIF reactions,
search, and consecutive-message grouping. The collection should feel cute, fun,
funny, and occasionally strange, rather than exclusively soft or romantic. Include
a dedicated custom bug emote and the standard bug emoji.

## Picker

- Offer Emotes, Emoji, and GIF tabs with an accessible search input.
- Search the built-in collection by name, aliases, and mood tags without an API key.
- Include a curated starter collection of at least 24 custom emotes and 36 GIFs,
  covering celebration, disbelief, panic, smugness, affection, boredom, and chaos.
- Custom emotes are small inline images, selectable from the picker or entered as
  recognized shortcodes such as `:bug:`, `:panic:`, and `:tiny_rage:`. Unknown
  shortcodes remain plain text. Never interpret message text as HTML.
- Show category filters and a bounded, locally saved recent-items list. Recents
  contain catalog/provider identifiers, not room messages or credentials.
- Retain ordinary Unicode emoji, including the bug emoji, as a separate option.
- Preserve keyboard tab navigation, Escape dismissal, focus restoration, mobile
  sizing, reduced-motion behavior, image-error labels, and rejected-message drafts.

## Artwork and provenance

Use curated custom original SVG emotes; original code-native icons are acceptable.
Use original artwork or assets with explicit permission for redistribution in this
app. Public visibility on Discord or 7TV is not sufficient permission. Record
creator, source, and license for every bundled third-party asset, and include any
required attribution. Existing GIF identifiers remain supported. Verify additions
visually and check their actual media responses; do not select by filename alone.
No asset purchases or third-party account setup are authorized by this design.

## Live GIF search

Use GIPHY as an optional live-search provider, configured with the public build-time
`VITE_GIPHY_API_KEY` and required Powered by GIPHY attribution. Leave existing
runtime/build/test configuration unchanged: no configuration endpoint, Worker
binding, server API proxy, or server-side provider verification call.

[GIPHY API integration requirements](https://developers.giphy.com/docs/api/),
particularly lines 143-151 reviewed on 2026-10-14, govern the new API integration:
all search and get-by-ID requests run directly in the browser. Preserve API-returned
media URLs exactly, including query parameters; keep those response URLs only in
active rendering state, never in catalogs, messages, local storage, durable storage,
or an app cache. Retain handpicked external GIF embeds and their exact catalog URLs
as the approved compatibility/keyless fallback, distinct from live API responses.
This feature does not migrate that catalog or remove its `.url` field.
Do not reorder/filter provider search results or mix other providers into their grid;
reject unsafe media at the rendering boundary with a labeled unavailable tile.

Keep curated search, previews, selection and message rendering available without
an API key and regardless of provider API failures or rate limits. Preserve
`ChatGif { id, label, url, tags? }`, all existing GIF aliases and exact legacy URLs;
expand the handpicked collection using the same shape. Do not require get-by-ID
for curated GIFs or replace working previews with no-key unavailable labels.
Emotes and Unicode emoji also remain fully available without a key.
Clearly distinguish a missing integration from an empty search result.
Debounce input, cancel obsolete searches, guard against out-of-order responses,
bound result pages, offer further results, and use the provider's general-audience
rating filter. Render loading, empty, failure, and retry states.

Send live GIF selections as `gifId: "giphy:<ID>"`, where ID is 1-64 ASCII alphanumeric
characters; continue accepting recognized legacy catalog aliases. The server
validates identifiers only and stores/broadcasts the identifier, never a URL or
resolved provider metadata. For live `giphy:<ID>` attachments only, each browser
resolves the provider ID fresh using GIPHY get-by-ID; curated aliases use their
static catalog URLs directly. Render only returned HTTPS URLs with exact hostnames
`media.giphy.com` or `media0.giphy.com` through `media4.giphy.com`, no credentials or
nonstandard port. Never synthesize canonical media paths. Bound response parsing,
timeouts and active requests, and provide unavailable/retry labels for missing,
unsafe, removed, or restricted media. Reuse existing chat authentication, flood
controls and send acknowledgments; provider failures must not discard drafts.

## Implementation Contracts

- `src/stream/chat-emotes.ts`: `ChatEmote { id, label, url, aliases, tags }`,
  `CHAT_EMOTES`, `getChatEmote` and `tokenizeChatEmotes`.
  Derive shortcodes from IDs and category matching from tags, without new required
  `src`, `shortcode`, `category` or provider-ID catalog fields.
- `src/stream/chat-media.ts` exports generic `searchChatMedia`; keep its existing
  location and picker imports. `src/client/lib/emojiSearch.ts` exports
  `searchEmoji(query)` with named subject/mood tags and literal-glyph matching.
- `src/stream/chat-gif-id.ts`: shared `isGiphyGifId`/`isChatGifId` validation;
  curated aliases or bounded provider IDs only, never client URLs.
- `src/client/lib/chatGrouping.ts`: `continuesChatGroup(previous, current)`;
  `mediaRecents.ts`: `readMediaRecents`/`rememberMedia` with bounded ID strings;
  `giphy.ts`: `getGiphyKey`, `safeGiphyMediaUrl`, `fetchGiphyPage`, `resolveGiphyGif`.
- `ChatGifAttachment.tsx` accepts `{ id: string }`, looks up curated aliases first,
  and resolves only live provider IDs. `ChatGifImage.tsx` owns the raw-URL helper
  `ChatGifImage({ url, label, onRetry? })`, used only with trusted curated or
  provider-validated URLs. Picker imports/re-exports it; attachment imports it
  directly. Preserve this dependency direction without circular re-exports.
  Render inline emotes through `tokenizeChatEmotes` in the existing chat panel.

## Consecutive messages

Add an opaque server-assigned random UUID `senderId` per successfully authenticated
socket to new messages, ignoring client-supplied sender IDs. It identifies an
authenticated connection within the current room session and grants no authority.
Do not derive it from the display name, password, or another secret. A reconnect
may receive a new ID and begin a new visual group.

For adjacent messages with the same sender ID and unchanged display name, show
the username and visible timestamp only on the first message and use tighter
spacing on subsequent messages. Another sender or a name change starts a new
group. Preserve accessible sender and timestamp information for each message.
Do not merge older messages without sender IDs solely because names match.
Grouping is presentation-only and does not change message IDs, order, history
limits, delivery acknowledgments, or storage invalidation.

## Compatibility and lifecycle

Keep existing chat-history entries readable. New optional fields must be checked
by socket parsing and local-cache validation; legacy messages do not require
migration. Maintain the 500-message cap and existing room-session invalidation:
history remains while an authenticated participant stays, and resets after the
last authenticated participant leaves. Display names remain emoji-friendly.

## Validation

Add focused tests for catalog search and aliases, shortcode tokenization, sender
identity and grouping, legacy histories, malformed/foreign media, provider errors,
stale search responses, and selected-media send failures. Verify that two people
with identical names never share a group. Run the existing test suite, client and
test typechecks, and production build. Browser-check both admin and viewer routes
at desktop and narrow mobile widths, including keyboard access, inline emotes,
GIF selection, grouping, and nonblank assets. Report whether live-provider checks
were exercised with a real configured key or only mocked.

### Current Status

Main-agent test evidence confirms identity, grouping and recents complete: 48 backend
tests, 32 composer/client tests, 11 hook tests and 21 combined client-library/hook
tests pass. These overlapping runs are not an additive full-suite total. Both source
reviews are approved with all findings resolved. Final browser QA and catalog/asset
completion and verification remain pending; source approval is not browser signoff.

## Delivery boundary

Keep this design and the subsequent implementation plan uncommitted under
`docs/plans/`. Implementation and validation are approved end-to-end for the main
agent; this planning task edits only these two documents. No commits are requested.
External account/key setup and deployment remain outside scope.
The transient chat connection delay is a separate investigation, not an assumed
consequence of message-history size or part of this picker change.
