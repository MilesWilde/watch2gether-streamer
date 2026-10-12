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
npm run deploy
```

The Worker name is configured as `watchparty` in `wrangler.jsonc`.

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
- Chat messages remain available while at least one authenticated participant stays in the room. When the last participant leaves, the chat session and its history reset.
- Browser chat caches are scoped to the current room session and cleared on leaving. Your preferred display name is saved separately and supports emoji.
- The chat picker includes emoji and a curated selection of GIFs; GIF images load from an external media host.
- The admin-selected playback speed carries over when videos change, including when the queue is cleared and refilled.
