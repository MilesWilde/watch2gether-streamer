# Human-designed emoji packs handoff

Removed the 24 generated root SVGs. The image-emote picker now offers 48 reactions
in OpenMoji and Twemoji variants (96 assets total), with searchable pack/mood
filters and visible source/license credits. Existing shortcodes map to OpenMoji;
Twemoji variants use prefixed identifiers such as `:twemoji_bug:`. Both packs
include the bug. GIFs, room history and consecutive-message grouping are unchanged.

Artwork is copied without modifications from OpenMoji 14.0.0 and Twemoji v14.0.2.
Full upstream licenses are bundled; `public/emotes/manifest.json` records source
URLs, versions, authors and SHA-256 hashes. Independent reviews compared all 96
artwork files and both license texts byte-for-byte against upstream and checked
all 48 OpenMoji author credits. Root-level generated SVGs are absent.

Verification: 130 tests across 8 files, both TypeScript checks, production build
and whitespace checks pass. Browser checks passed for admin/viewer routes, both
packs and inline variants, all 96 nonblank asset pixel checks, search/categories,
recents, keyboard controls and credit/license links. Viewports: 1440x900,
1024x900, 768x500, 390x844, 390x568 and 320x568. Removed `/emotes/bug.svg` returns
404. Two independent reviews report no actionable findings.

Preview: http://localhost:8791/ (`qa-viewer`) and /admin (`qa-admin`).
Screenshots: `/tmp/watchparty-openmoji-picker.png` and
`/tmp/watchparty-twemoji-picker.png`.

Proposed PR title: Replace generated chat emotes with credited emoji packs

Proposed PR body: Remove generated emote artwork and provide unmodified OpenMoji
and Twemoji originals with pack filtering, source credits, full licenses and
checksum-backed provenance. Preserve existing shortcodes and all room behavior.
Validation: 130 tests, both typechecks, build, independent source verification and
desktop/mobile browser checks.

Keep all `docs/plans/` artifacts uncommitted.
