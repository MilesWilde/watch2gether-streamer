# Resilient Chat And Reactions Handoff

## Delivery

Local deployment-ready changes on the existing branch. Working design, plan,
and handoff files remain uncommitted. Earlier dirty work is preserved.

- Temporary WebSocket outages retain the room, YouTube iframe, history, text,
  and selected GIF. Fresh authoritative snapshots gate shared controls.
- Leaving or rejected credentials clears room state. A replacement room session
  invalidates expired history without resetting an unsent draft.
- Playback reconciliation uses current callbacks and fresh connection state,
  restores unchanged snapshots after buffering, and handles offline video ends
  without replaying already pending advancement commands. Existing persistent
  playback speed is covered by the regression suite.
- One Emoji tab combines Unicode and image reactions; GIFs remain separate.
  Picker pages are bounded to 96 emoji or 24 GIFs with lazy-loaded media.
- Colon autocomplete searches across packs, replaces the token at the caret,
  supports arrows, Enter, Tab, Escape, IME, and Shift+Enter, and scrolls the
  selected suggestion into view.
- 1,550 human-made image reactions: 1,222 OpenMoji, 48 Twemoji, 280 Neocat.
  Source licenses, per-asset attribution, and checksums are bundled.
- 200 locally hosted Animated Noto GIFs, including cats and bugs. Mechanical
  resizing reduces the collection from about 202 MB to 50 MB. Google CC BY 4.0
  attribution, transformations, original/output hashes, and full license are
  recorded. Legacy GIF aliases remain compatible but are not searchable.

## Verification

```sh
npm test -- --run
npx tsc --noEmit
npx tsc --noEmit -p test/tsconfig.json
npm run build
git diff --check
node --experimental-vm-modules --test --test-isolation=none scripts/test-import-emoji-packs.mjs
npx wrangler deploy --dry-run --outdir /tmp/watchparty-deploy-ready
```

156 application tests and 21 importer tests pass. Both type checks, build,
whitespace check, and deployment dry run pass. The client build has a
non-blocking size warning (about 671 KB raw / 142 KB gzip).

Playwright script: `/tmp/watchparty-resilient-check.cjs`. It verifies real
two-client room WebSockets, mounted iframe/composer identity with a stubbed
YouTube API, draft/GIF retention, authoritative session invalidation, offline
controls, caret-aware autocomplete and keyboard navigation, visible selected
suggestions, actual artwork pixels, GIF rendering/pagination, and six viewport
sizes from 320 to 1440 pixels. This is not a live YouTube service playback test.
Separate byte verification matches all 200 local GIF files to the manifest.

Preview: http://localhost:8792/ and http://localhost:8792/admin.
Local QA passwords: `qa-viewer` and `qa-admin`.

## Review Resolutions

Fixed stale retained-iframe callbacks, offline advancement latching, native
iframe controls remaining active while disconnected, offscreen selected
autocomplete options, and skipped playback reconciliation on identical snapshots.
Added negative playback cases for changed item/epoch, paused playback, and
already pending advancement. Fixed verified importer restoration of missing
files while retaining corruption and path/source checks.

Replaced the proposed searchable GIPHY index with licensed local animations
after checking provider restrictions. Live GIPHY results remain direct-browser,
provider-ordered, separate from local content, and provider-ID-only in storage.
The picker and message credits expose the shipped attribution and transformation
notices. Final review found no remaining permission or attribution issues for
the new local Noto catalog; this does not grant rights to legacy GIPHY content.

## Deployment Notes

Neocat is noncommercial-only under CC BY-NC-SA 4.0, consistent with the user's
confirmed personal/noncommercial use. Broader character GIF search, including
CAPOO, requires the optional public `VITE_GIPHY_API_KEY` build variable; the
200 local GIFs work without that key. Confirm the intended Cloudflare account
with `npx wrangler whoami` before `npm run deploy`. Existing Worker bindings and
secret names are unchanged; no data migration is required.

## Proposed PR

Title: Keep watch rooms mounted during reconnects and expand chat reactions

Body:

Preserve the player, history, and draft through temporary connection loss while
requiring fresh snapshots before shared commands resume. Merge emoji and emotes,
add caret-aware colon autocomplete, and bundle credited human-made emoji and
licensed animated GIF catalogs with bounded lazy rendering.

Validation: 156 application tests, 21 importer tests, both TypeScript checks,
production build, deployment dry run, and desktop/mobile two-client browser QA.
Neocat requires noncommercial use; optional live GIPHY search requires a public
build-time key.
