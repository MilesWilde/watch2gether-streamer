# Robot Chat Profiles

The user chose the tiny robot builder, approved Bottts by Pablo Stanley after
reviewing free asset options, and authorized implementation, dependency setup
and verification as one batch.

The profile editor uses the existing chat-name edit location. A compact modal
offers face, eyes, mouth, top and side parts; robot, background and readable
name-color swatches; Randomize; and an emoji-capable 40-code-point display name.
Its preview renders the same locally bundled Bottts artwork used by chat.
Cancel discards edits. Offline editing stays available but Save is disabled.
A successfully queued Save closes as the old name editor did; a failed queue
keeps the draft. Only an authenticated server acknowledgement persists changes.

Profiles contain eight allowlisted scalar choices, never uploaded images,
arbitrary SVG, colors or URLs. Server-owned per-socket profiles are copied onto
future messages; historical appearance is not rewritten. Legacy messages use
the default robot. Any visible profile change starts a fresh consecutive chat
header while identical profiles retain ordinary grouping.

The existing name_updated acknowledgement carries an optional profile, keeping
legacy clients compatible. Authentication optionally supplies the acknowledged
local profile and set_profile updates name and appearance together. Temporary
disconnects and explicit Leave retain preferences while keeping the previously
approved chat-history lifetime and notification behavior unchanged.

Rendering uses patched, pinned DiceBear core/Bottts 9.4.3 with no avatar network
service. The editor links Pablo Stanley's artwork credit and the bundled MIT
software notice at public/avatars/BOTTTS-LICENSE.txt. The artwork is supplied by
the artist, not generated with AI. No deployment or account change is included.
