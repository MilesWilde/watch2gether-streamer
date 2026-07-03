# Watchparty

A small Cloudflare Workers watch-party app for shared YouTube playback.

Viewers can join with a room password, request YouTube videos, and watch the current playlist. Admins can approve or deny requests, control playback, skip videos, remove playlist items, and clear the room.

## Stack

- Cloudflare Workers
- Durable Objects for room state and WebSocket coordination
- Cloudflare Workers static assets for `public/`
- Plain browser JavaScript using the YouTube iframe API

## Local Setup

Install dependencies:

```sh
npm install
```

Create a `.dev.vars` file for local Wrangler development:

```sh
ROOM_PASSWORD=your-viewer-password
ADMIN_PASSWORD=your-admin-password
```

Start the local Worker:

```sh
npm run dev
```

Open:

- Viewer room: `http://localhost:8787/`
- Admin room: `http://localhost:8787/admin`

## Production Secrets

Set both secrets before deploying:

```sh
npx wrangler secret put ROOM_PASSWORD
npx wrangler secret put ADMIN_PASSWORD
```

Or run:

```sh
./update-stream-password.sh
```

## Deploy

Deploy to Cloudflare:

```sh
npm run deploy
```

The Worker name is configured as `watchparty` in `wrangler.jsonc`.

## Useful Commands

```sh
npm run dev        # local Wrangler dev server
npm run deploy     # deploy Worker
npm run cf-typegen # regenerate Worker binding types
npx tsc --noEmit   # type-check
```

## Notes

- Room state is persisted in the `StreamRoom` Durable Object.
- The current room uses a single Durable Object name: `global`.
- Viewer playback controls are disabled so only the admin controls shared playback.
- Browser autoplay policies can still require viewers to interact with the page before audio playback works.
