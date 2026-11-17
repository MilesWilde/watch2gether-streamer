# Room Experience Design

Improve the existing watch room on top of baseline commit ec35a7b. Keep this working document uncommitted.

## Layout

Prioritize the 16:9 video. Wide windows show the player beside chat, with requests and playlist below. As available width decreases, move supporting panels below the player before reducing its available width. On phones, use the full available width with wrapping controls and bounded, independently scrolling chat. Keep titles and metadata readable without horizontal overflow. Preserve the existing application style and playlist import workflow.

## Chat

The existing room owns an authoritative session ID and ordered message history. Only authenticated participants can send messages. Keep history while at least one authenticated participant remains; reset immediately when the last participant disconnects. Rejoining participants receive the current snapshot. A restarted room starts a new chat session rather than resurrecting historical messages.

Local storage caches a bounded snapshot keyed by room and session. Display history only after authentication and confirmation from the room. Clear the local message cache when leaving; keep the preferred display name separately. Offer an explicit Leave command. Names support emoji. Render text as text, enforce name and message limits, and allow GIFs only from a curated shared catalog. Provide a compact accessible picker with numerous emoji and cute animated GIF choices, keyboard dismissal, and constrained dimensions on phones.

## Playback

Keep the admin-selected shared playback rate through automatic advancement, manual switching, and removal of the current video. Preserve it when clearing the queue until the admin changes it. Correct state transitions that currently create a stopped state at 1x. Reapply the desired rate when YouTube has cued or begun playing a new video, including viewers, because video loading resets the iframe rate.

## Validation

Test authenticated chat, message validation, retained history on partial departure, new session on empty room, cache invalidation, emoji names, and rate preservation. Run the configured build and TypeScript checks. Verify desktop, intermediate, and phone layouts in a browser when available, including overflow, picker placement, chat scrolling, and visible video. Review both specification compliance and code quality before handoff.

## Research

Watch2Gether's width-dependent layout feedback highlights the importance of adapting to available space rather than assuming a narrow window is a phone: https://community.w2g.tv/t/desktop-version-keeps-opening-with-the-mobile-layout/188879

YouTube's miniplayer keeps playback available while users interact with surrounding content: https://support.google.com/youtube/answer/9162927?hl=en
