# Human-designed emoji pack replacement

## Approved Change

Remove all 24 Codex-generated SVG emotes from `public/emotes`. Replace them with
unmodified, locally served artwork from OpenMoji and Twemoji, with a searchable
pack selector and proper attribution. Keep the existing 24 shortcodes readable.

## Sources And Compatibility

Use pinned, credited 2022 releases: OpenMoji 14.0.0 (CC BY-SA 4.0) and Twemoji
v14.0.2 (CC BY 4.0). Preserve downloaded original bytes and full upstream license
texts. Record source URLs, versions, credited authors and SHA-256 digests in a
local manifest. The legacy shortcodes select corresponding OpenMoji artwork;
Twemoji variants use `twemoji_`-prefixed IDs. Add 24 more reaction definitions to
both packs, for 96 image-emote choices total. Include the bug in both packs.

Retain the external GIF collection and source credits, plain Unicode emoji,
message storage format, name handling and message grouping unchanged.

## UI

Add an Emoji pack select to the Emotes tab beside the existing mood select.
Support OpenMoji, Twemoji and All packs; default to OpenMoji. Search matches
reaction names, aliases and tags within the selected pack. Display the selected
pack's attribution/license links. Selecting an image still inserts its shortcode,
and messages render the matching pack-specific local asset.

## Validation

Tests first: catalog completeness and unique IDs, all legacy mappings, bug
availability, pack metadata, nested assets, source hashes, attribution and absence
of generated root SVGs. Preserve tokenizer/GIF/search tests. Run the full suite,
both TypeScript checks and production build. Browser-check both packs and inline
messages on viewer/admin routes, search/recents/keyboard navigation, narrow and
short viewports, and nonblank image pixels. Verify local files match pinned
upstream bytes rather than redrawing or regenerating artwork.

Keep design/plan artifacts uncommitted. This scope authorizes implementation and
checks, not publication, account changes or unrelated refactoring.
