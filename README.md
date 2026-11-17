# Watchparty

A small Cloudflare Workers watch-party app for shared YouTube playback.

Viewers can join with a room password, request YouTube videos, and watch the current playlist. Admins can approve or deny requests, control playback, skip videos, remove playlist items, and clear the room.

## Stack

- Cloudflare Workers
- Durable Objects for room state and WebSocket coordination
- Cloudflare Workers static assets for `public/`
- React frontend built with Vite
- YouTube iframe API for playback
- YouTube Data API v3 for playlist imports

## Local Setup

Install dependencies:

```sh
npm install
```

Create a `.dev.vars` file for local Wrangler development:

```sh
ROOM_PASSWORD=your-viewer-password
ADMIN_PASSWORD=your-admin-password
YOUTUBE_API_KEY=your-youtube-data-api-key
```

Start the local Worker:

```sh
npm run dev
```

Open:

- Viewer room: `http://localhost:8787/`
- Admin room: `http://localhost:8787/admin`

## Chat Profiles

Use Edit profile beside your chat name to build a robot avatar from Bottts
parts: face, eyes, mouth, top and sides. Robot, background and readable name-color
swatches update a live preview; Randomize changes the robot without changing
your name. Display names support emoji and the existing 40-code-point limit.

Profiles are rendered locally with pinned DiceBear core/Bottts 9.4.3; there is
no external avatar service or image upload. The browser stores only validated
scalar choices after a server acknowledgement, retaining them across Leave,
reload and reconnect. Cancel leaves the saved profile unchanged, and editing
can continue offline while Save waits for a connection.

New chat messages carry a server-owned snapshot of the sender's profile.
Changing a name, robot or name color starts a new chat header without rewriting
earlier messages. Older messages without profile data use a default robot.

Artwork is [Bottts by Pablo Stanley](https://bottts.com/), provided free for
personal and commercial use; the renderer code is MIT licensed. Local
[artwork credits and software notices](public/avatars/BOTTTS-LICENSE.txt)
are linked from the editor. Avatar SVG is generated from the bundled artwork,
not supplied by users or AI-generated.

## Chat Reactions

Chat includes searchable image emotes, ordinary emoji, and a curated GIF
collection. Image emotes also work as shortcodes, including `:bug:`, `:panic:`,
and `:tiny_rage:`. Emoji and image emotes share one Emoji tab; GIFs have their
own tab. Type a colon followed by a letter to search across all emoji packs.
Use arrow keys to choose, Enter or Tab to insert, and Escape to dismiss.
The picker opens beside your mouse click, capped at 320 by 360 pixels and kept
inside the screen edges. Keyboard activation anchors it to the emoji button.
Search and pack filters cover the
complete catalog; both tabs load more results as you scroll, with lazy-loaded
images. Each tab remembers its search, filters, and scroll position when closed
and reopened. Bounded browser-storage bookmarks also restore your place after
a reload; live GIF results are fetched again rather than stored on disk.
Consecutive messages from the same connection share a name
header; identical display names from different people stay separate.
The built-in GIF collection has 200 distinct, locally hosted Animated Noto Emoji
GIFs, including cat and bug reactions. It is searchable without an API key.

For optional live GIPHY search, create a dedicated public web API key through
[GIPHY Developers](https://developers.giphy.com/docs/api/) and add it to a local
`.env.local` before building:

```sh
VITE_GIPHY_API_KEY=your-public-web-api-key
```

Rebuild with `npm run build` (or `npm run deploy`). This key is included in the
browser bundle; never use a private credential. It is a Vite build variable, not
a Wrangler secret. The picker offers live search under GIFs > Search GIPHY.
Search and GIF resolution call GIPHY directly from the browser. Live GIF messages
and recents store provider IDs only, not provider-returned media URLs. Without a
key, the built-in emotes and curated collection remain available.
Search GIPHY for character reactions such as Bugcat CAPOO. The built-in picker
does not maintain a searchable index of GIPHY uploads: GIPHY's API terms prohibit
building GIF databases/directories, and its integration rules restrict storing
media URLs. Live results are kept separate from the locally licensed collection.

### Artwork Sources

Image emotes include 1,550 unmodified, human-made assets: 1,222 OpenMoji SVGs,
48 Twemoji SVGs, and 280 Neocat PNGs. Ordinary Unicode emoji are also available:

- [OpenMoji 14.0.0](https://github.com/hfg-gmuend/openmoji/tree/14.0.0):
  artwork by the OpenMoji contributors, licensed under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
  [Upstream license](https://github.com/hfg-gmuend/openmoji/blob/14.0.0/LICENSE.txt).
- [Twemoji v14.0.2](https://github.com/twitter/twemoji/tree/v14.0.2):
  graphics copyright Twitter, Inc. and other contributors, licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
  ([upstream graphics license](https://github.com/twitter/twemoji/blob/v14.0.2/LICENSE-GRAPHICS)),
  separately from Twemoji's MIT-licensed code.
- [Neocat by Volpeon](https://volpeon.ink/emojis/neocat/):
  licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
  **Personal/noncommercial use only.** Remove or separately license this pack
  before commercial use. The official archive is pinned by SHA-256 rather than
  an asserted numbered release; its original license and metadata are bundled.

The [asset manifest](public/emotes/manifest.json) records per-asset source URLs,
author credits and SHA-256 checksums. Full upstream licenses are included in
[OpenMoji's directory](public/emotes/openmoji/LICENSE.txt) and
[Twemoji's directory](public/emotes/twemoji/LICENSE-GRAPHICS.txt), and
[Neocat's directory](public/emotes/neocat/LICENSE.txt). The picker has
an Emoji pack selector and source/license credits. Existing unprefixed shortcodes
use OpenMoji; Twemoji variants use `:twemoji_bug:`-style shortcodes, and Neocat
retains its upstream `:neocat_...:` names. Additional OpenMoji entries use
`:openmoji_<codepoint>:` identifiers. Reproduce the expanded catalog with
`node scripts/import-emoji-packs.mjs`; provenance stays in the full manifest
while the client loads the smaller generated runtime catalog.

The local GIF collection uses Google's human-designed
[Animated Noto Emoji](https://googlefonts.github.io/noto-emoji-files/), licensed
under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Its original
animations are bundled locally with attribution and a full license; the
[GIF source manifest](public/GIF-SOURCES.json) records source URLs, checksums,
mechanical resizing to 160px/15fps, and animation verification. Original and
served-file hashes are retained. Google introduced the open-source animations in
[2022](https://developers.googleblog.com/en/updates-to-emoji-new-characters-new-animation-new-color-customization-and-more/).

Legacy GIF message aliases remain compatible but are not part of the searchable
collection. Their GIPHY media remains externally hosted and owned by its creators;
[existing source credits](public/emotes/LICENSE.txt) and
[GIPHY attribution](public/GIPHY-ATTRIBUTION.txt) remain separate from local licenses.

## Production Secrets

Set secrets before deploying:

```sh
npx wrangler secret put ROOM_PASSWORD
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put YOUTUBE_API_KEY
```

Or run:

```sh
./update-stream-password.sh
```

## Deploy

Deploy to Cloudflare:

```sh
npx wrangler whoami
npm run deploy
```

Confirm that `whoami` lists the intended Cloudflare account before deploying.
The Worker name is configured as `watchparty` in `wrangler.jsonc`. To validate
the deployment bundle without publishing, run `npm run build` followed by
`npx wrangler deploy --dry-run`.

## Useful Commands

```sh
npm run dev        # local Wrangler dev server
npm run build      # build React assets into public/dist
npm run deploy     # deploy Worker
npm run cf-typegen # regenerate Worker binding types
npx tsc --noEmit   # type-check
```

## Notes

- Room state is persisted in the `StreamRoom` Durable Object.
- The current room uses a single Durable Object name: `global`.
- Admin video requests are added directly to the playlist.
- Viewer video requests wait for admin approval.
- Playlist imports preview up to 200 public videos before submitting requests.
- Viewer playback controls are disabled so only the admin controls shared playback.
- Browser autoplay policies can still require viewers to interact with the page before audio playback works.
- The room layout prioritizes the video, moving chat and queue panels below it on narrower windows.
- Chat messages remain available while at least one authenticated participant stays in the room. If the last connection drops unexpectedly, history stays available for a 60-second reconnect grace period; an authenticated return cancels cleanup. Clicking Leave clears the session immediately only when nobody else remains. History stays transient: a server actor restart creates a new session.
- Browser chat caches are scoped to the current room session and cleared on leaving. Your preferred display name is saved separately and supports emoji.
- Temporary connection loss and page suspension keep the player, visible history, draft and chat cache intact. Sending and shared playback controls wait for fresh server snapshots. Reconnecting reconciles same-session messages by ID; a server-confirmed new session replaces expired history without discarding an unsent draft. Uncertain sends are never replayed automatically.
- The player settings cog controls the chat overlay, its left/right position and text opacity, theater mode, and quiet tab-title notifications. A separate Chat sidebar position setting places the full chat and composer on the left or right, independently of the overlay. The sidebar container spans the visible browser height, with 12px of internal top/bottom padding, scrolling history, and the composer at the bottom; the header and queue reserve its column. On narrow windows chat stays below the video. The separate overlay uses 10% margins from the video's top, bottom, and selected side and mirrors recent messages, newest first, for 12 seconds, then fades them out over 3 seconds; the original messages remain in chat. Its horizontal inset follows the selected side, and messages that exceed the video height are clipped. The overlay has no background panel and lets clicks pass through to the video. Viewing preferences are saved in this browser's localStorage and do not change anyone else's view. Press `T` outside inputs and dialogs to toggle theater mode, or use the theater button.
- Chat notifications start on each time you join; automatic reconnects preserve your choice. New messages while hidden or unfocused show `(n) Watch Party`; returning, disabling notifications or leaving clears the count. Initial history and your own messages do not notify. There are no sounds, browser notifications or permission prompts.
- For disconnect debugging, filter the browser console for `[watchparty:socket]` and Worker logs for `[watchparty:room]`. Records include close codes, sanitized reasons, clean-close status, retry attempts, connection duration, heartbeat age and history reset/cleanup causes. Chat contents, names and credentials are excluded; heartbeat responses update diagnostic ages without adding continuous console chatter.
- The chat picker includes image emotes, emoji, and searchable GIFs; GIF images load from an external media host.
- The admin-selected playback speed carries over when videos change, including when the queue is cleared and refilled.
- The server owns the playback timeline. Play, pause and speed changes advance the server anchor; iframe clock samples never replace it. Admins seek using the app's seek slider. Seek and automatic end-of-video commands include the current playlist item and playback revision, so delayed commands cannot change a newer timeline. Native iframe transport controls are replaced by the app controls.
- Every connected player checks its own drift against sampled server time and corrects locally. A playing iframe whose clock stops advancing is recreated locally with a recovery cooldown. A socket that receives no heartbeat response for 20 seconds reconnects automatically, preserving chat during recovery.
- For sync debugging, filter the browser console for `[watchparty:sync]` and `[watchparty:socket]`. Exceptional events report local corrections, stalled clocks, iframe recovery, and heartbeat timeouts. Worker logs use `[watchparty:sync]` for rejected stale commands. These diagnostics use existing console logging with no extra service, dependency, or paid monitoring. They contain numeric timing/state information, not chat text, names, or credentials.
