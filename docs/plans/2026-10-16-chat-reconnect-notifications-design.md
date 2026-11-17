# Reconnect-Safe Chat and Tab Notifications

Approved by the user's request to read and implement the proposed reconnect
policy, plus a default-on unread-count toggle beside Leave.

Unexpected WebSocket loss preserves visible chat and its browser cache. Same
room-session history reconciles IDs after authentication; a confirmed new room
session replaces the old transcript. The last unexpected departure schedules a
60-second Durable Object alarm. An authenticated return cancels cleanup;
explicit Leave immediately clears history only when no participant remains.
Chat remains transient in actor memory, as before: actor restarts still create
a new session, and logs distinguish initialization from empty-room cleanup.

Browser and server diagnostics record event/cause, socket close metadata,
connection duration, retry attempts, heartbeat age and chat reset reasons, not
credentials, display names or message contents.

Notifications are a per-join default-on toggle, not an OS permission.
Only unseen messages received while hidden/unfocused contribute to the title
`(n) Watch Party`. Focus clears the count; disabling and leaving restore the
base title. Reconnects do not reset the preference. Initial history is not new
mail; same-session missed messages are counted once by message ID.
