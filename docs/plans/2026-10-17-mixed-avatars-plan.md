# Mixed Avatar Parts

**Goal:** Allow cat, insect, and robot features on the same chat avatar.

**Design:** Keep the current scalar profile protocol and legacy robot rendering. Add independent ears, whiskers, wings, and limbs alongside the existing head, eyes, mouth, antenna/top, and side slots. Normalize trusted, attributed source artwork onto a common canvas, with head-specific anchors and back-to-front layering. Users cannot supply SVG or asset URLs. New optional slots default to None for old profiles. Preserve hover previews, cancellation, name colors, local persistence, and per-message snapshots.

**Sources:** Existing Pablo Stanley Bottts artwork and pinned OpenMoji 15.1.0 cat, lady beetle, ant, mosquito, and butterfly SVGs. Keep source attribution, modification notes, and CC BY-SA artwork notices separate from application code.

## Implementation
- [ ] Add failing tests for mixed profiles, invalid parts, legacy defaults, and independent visible layers.
- [ ] Adapt source SVG geometry and implement a deterministic, locally rendered compositor.
- [ ] Extend validated profiles and migration without accepting arbitrary SVG or URLs.
- [ ] Extend the existing editor and memoized avatar rendering with independent part controls and hover previews.
- [ ] Verify protocol, persistence, editor, and renderer tests, type checking, production build, desktop/mobile layout, and mixed-avatar pixels.

## Review Checks
- Ears and antennae coexist; proboscis does not replace the head or ears.
- Wings and limbs are behind the head; facial details remain visible.
- Existing eight-field robot profiles keep their existing appearance.
- New profile fields are projected and validated on both client and server.
- Default and None extras are equivalent for message grouping.
