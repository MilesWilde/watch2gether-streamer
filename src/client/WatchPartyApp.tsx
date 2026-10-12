import { useCallback, useMemo, useState } from "react";
import type { ChatResultServerMessage, ClientMessage, ServerMessage } from "../stream/messages";
import type { StreamState, UserRole } from "../stream/playlist";
import { AuthPanel } from "./components/AuthPanel";
import { PlaylistPanel } from "./components/PlaylistPanel";
import { PlayerPanel } from "./components/PlayerPanel";
import { RequestVideoPanel } from "./components/RequestVideoPanel";
import { RequestsPanel } from "./components/RequestsPanel";
import { RoomHeader } from "./components/RoomHeader";
import { ChatPanel } from './components/ChatPanel';
import { useRoomChat } from './hooks/useRoomChat';
import { useWatchPartySocket } from "./hooks/useWatchPartySocket";
import {
	clearSavedPassword,
	getSavedPassword,
	savePassword
} from "./lib/savedPassword";

export function WatchPartyApp() {
	const authMode = useMemo<UserRole>(
		() => (window.location.pathname === "/admin" ? "admin" : "viewer"),
		[]
	);
	const [password, setPassword] = useState(() => {
		try {
			return getSavedPassword(authMode);
		} catch {
			return '';
		}
	});
	const [role, setRole] = useState<UserRole>("viewer");
	const [listenerCount, setListenerCount] = useState(0);
	const [streamState, setStreamState] = useState<StreamState | null>(null);
	const [serverError, setServerError] = useState<string | null>(null);
	const [sessionRequested, setSessionRequested] = useState(() => Boolean(password));
	const chat = useRoomChat();
	const [chatResult, setChatResult] = useState<{ sessionId: string; result: ChatResultServerMessage } | null>(null);

	const handleServerMessage = useCallback((message: ServerMessage): void => {
		chat.onMessage(message);
		switch (message.type) {
			case "authenticated":
				setRole(message.role);
				setListenerCount(message.listenerCount);
				setServerError(null);
				break;
			case "presence":
				setListenerCount(message.listenerCount);
				break;
			case "state":
				setStreamState(message.state);
				break;
			case "error":
				setServerError(message.message);
				break;
			case "chat_result":
				if (sessionRequested && chat.ready && chat.sessionId) {
					setChatResult({ sessionId: chat.sessionId, result: message });
				}
				break;
			case "pong":
				break;
		}
	}, [chat.onMessage, chat.ready, chat.sessionId, sessionRequested]);

	const handleAuthenticationFailed = useCallback(
		(message: string): void => {
			try {
				clearSavedPassword(authMode);
			} catch {
				/* Storage is optional. */
			}
			setPassword("");
			setSessionRequested(false);
			setRole("viewer");
			setStreamState(null);
			setListenerCount(0);
			chat.clear();
			setChatResult(null);
			setServerError(message);
		},
		[authMode, chat.clear]
	);

	const handleAuthenticationLost = useCallback((): void => {
		setRole("viewer");
		setStreamState(null);
		setListenerCount(0);
		chat.clear();
		setChatResult(null);
	}, [chat.clear]);

	const socket = useWatchPartySocket({
		authMode,
		password,
		enabled: sessionRequested,
		preferredName: chat.name,
		onMessage: handleServerMessage,
		onAuthenticationFailed: handleAuthenticationFailed,
		onAuthenticationLost: handleAuthenticationLost
	});

	const status = serverError ?? socket.status;

	function authenticate(nextPassword: string): void {
		setPassword(nextPassword);
		try {
			savePassword(authMode, nextPassword);
		} catch {
			/* Storage is optional. */
		}
		setServerError(null);
		setSessionRequested(true);
	}

	function send(message: ClientMessage): void {
		setServerError(null);
		socket.send(message);
	}

	function leave(): void {
		socket.leave();
		setSessionRequested(false);
		setStreamState(null);
		setListenerCount(0);
		setRole('viewer');
		setServerError(null);
		chat.clear();
	}

	return (
		<main className="app-shell">
			<RoomHeader status={status} listenerCount={listenerCount} onLeave={sessionRequested ? leave : undefined} />

			{socket.authenticated ? (
				<div className="room-content">
					<section className="layout" aria-label="Watch room">
						<PlayerPanel role={role} state={streamState} onSend={send} onStatusChange={setServerError} />
						<ChatPanel
							key={chat.sessionId ?? 'pending'}
							messages={chat.messages}
							name={chat.name}
							ready={socket.authenticated && chat.ready}
							error={serverError}
							result={chatResult?.sessionId === chat.sessionId ? chatResult.result : null}
							onSend={(text, gifId, requestId) => {
								if (!sessionRequested || !chat.ready) return false;
								setServerError(null);
								return socket.send({ type: 'send_chat', text, requestId, ...(gifId ? { gifId } : {}) });
							}}
							onNameChange={name => {
								setServerError(null);
								return socket.send({ type: 'set_name', name });
							}}
						/>
					</section>
					<section className="support-band" aria-label="Requests and queue">
						<div className="request-support">
							<RequestVideoPanel mode={authMode} password={password} onSend={send} onStatusChange={setServerError} />
							<RequestsPanel role={role} requests={streamState?.requests ?? []} onSend={send} />
						</div>
						<PlaylistPanel
							role={role}
							playlist={streamState?.playlist ?? []}
							currentIndex={streamState?.currentIndex ?? 0}
							onSend={send}
						/>
					</section>
				</div>
			) : (
				<AuthPanel mode={authMode} status={status} onAuthenticate={authenticate} />
			)}
		</main>
	);
}
