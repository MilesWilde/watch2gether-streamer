# Human Emoji Packs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generated emotes with 96 locally served, credited OpenMoji and Twemoji originals while retaining existing shortcodes and GIF behavior.

**Architecture:** Pin OpenMoji 14.0.0 and Twemoji v14.0.2; retain original SVG bytes and full upstream licenses. Catalog entries identify their pack, codepoint and author; the manifest records source URLs and SHA-256 digests. The picker filters by pack alongside existing search and mood controls.

**Tech Stack:** TypeScript, React, Vite raw/JSON imports, Vitest with the existing Cloudflare Workers pool, Web Crypto SHA-256.

## Ownership

- Test/docs worker: `test/chat-media.test.ts`, `README.md`, this plan.
- Main worker: `src/stream/chat-emotes.ts`, `public/emotes/`, picker implementation and browser validation.
- Preserve unrelated working-tree changes. Keep this plan and design uncommitted; this task does not request any commits.

## Task 1: Contract Tests First

- [x] Replace original-art/CC0 assertions in `test/chat-media.test.ts` with pinned pack metadata, 48 entries per pack, 96 unique IDs/paths, all 24 legacy OpenMoji mappings, paired Twemoji IDs and bug codepoint checks.
- [x] Add nested raw SVG safety and official 72/36 viewBox checks; reject root-level SVG leftovers.
- [x] Check Vite-imported manifest metadata, pinned raw upstream paths and SHA-256 using `crypto.subtle`; require full licenses and retain GIF source-link tests.
- [x] Run escalated `npm test -- --run test/chat-media.test.ts`: observed 5 expected failures and 9 passes before production edits. Report red immediately to main.

## Task 2: Main Worker Assets And Catalog

- [x] Download 48 originals per pinned release into `public/emotes/openmoji/` and `public/emotes/twemoji/`; remove the 24 root SVGs. Use uppercase OpenMoji and lowercase Twemoji hex filenames.
- [x] Preserve upstream license texts at `openmoji/LICENSE.txt` and `twemoji/LICENSE-GRAPHICS.txt`; replace overall attribution while preserving the existing external GIF source section.
- [x] Populate `CHAT_EMOTE_PACKS` and 96 `ChatEmote` entries in `src/stream/chat-emotes.ts`; retain lookup/tokenizer behavior and add pack/codepoint/author metadata. Keep 24 legacy IDs plus 24 additional OpenMoji IDs; prefix all paired Twemoji IDs with `twemoji_`.
- [x] Generate `public/emotes/manifest.json` with `packs` and `assets`; verify downloaded bytes against pinned upstream sources, not only the local manifest.
- [x] Rerun `npm test -- --run test/chat-media.test.ts`; all 14 tests pass, including official SVG polygon primitives.

## Task 3: Main Worker Picker And Verification

- [x] Add OpenMoji (default), Twemoji and All packs to the Emotes pack selector; combine pack selection with existing search/mood filtering and show credited license/source links.
- [x] Preserve shortcode insertion, recent selections, plain emoji, GIF behavior and stored message formats.
- [x] Run `npm test -- --run`, `npx tsc --noEmit`, `npx tsc --noEmit -p test/tsconfig.json` and `npm run build`; 130 tests and both typechecks/build pass.
- [x] Browser-check viewer/admin routes, both packs, inline shortcode messages, search, recents and keyboard navigation at desktop/narrow/short viewports; all 96 assets render nonblank pixels, six sizes fit, and the removed generated bug URL returns 404.

## Task 4: Documentation Handoff

- [x] Add pinned artwork source/credit/license links to `README.md`, using rollout language until implementation is verified.
- [x] Main worker updates rollout wording and task status after implementation and verification. Independent specification and code-quality reviews report no actionable findings.
