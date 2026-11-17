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
import { useChatNotifications } from './hooks/useChatNotifications';
import { useWatchPartySocket } from "./hooks/useWatchPartySocket";
import { useWatchPreferences } from './hooks/useWatchPreferences';
import { WatchSettings } from './components/WatchSettings';
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
	const [hasJoined, setHasJoined] = useState(false);
	const [stateReady, setStateReady] = useState(false);
	const viewing = useWatchPreferences(sessionRequested && hasJoined);
	const chat = useRoomChat();
	const notifications = useChatNotifications(sessionRequested);
	const [chatResult, setChatResult] = useState<{ sessionId: string; result: ChatResultServerMessage } | null>(null);

	const handleServerMessage = useCallback((message: ServerMessage): void => {
		chat.onMessage(message);
		notifications.onMessage(message);
		switch (message.type) {
			case "authenticated":
				setHasJoined(true);
				setRole(message.role);
				setListenerCount(message.listenerCount);
				setServerError(null);
				break;
			case "presence":
				setListenerCount(message.listenerCount);
				break;
			case "state":
				setStateReady(true);
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
	}, [chat.onMessage, chat.ready, chat.sessionId, sessionRequested, notifications.onMessage]);

	const handleAuthenticationFailed = useCallback(
		(message: string): void => {
			try {
				clearSavedPassword(authMode);
			} catch {
				/* Storage is optional. */
			}
			setPassword("");
			setSessionRequested(false);
			notifications.clear();
			setRole("viewer");
			setStreamState(null);
			setListenerCount(0);
			chat.clear();
			setChatResult(null);
			setServerError(message);
		},
		[authMode, chat.clear, notifications.clear]
	);

	const handleAuthenticationLost = useCallback((): void => {
		setHasJoined(false);
		setStateReady(false);
		setRole("viewer");
		setStreamState(null);
		setListenerCount(0);
		chat.clear();
		setChatResult(null);
	}, [chat.clear]);

	const handleConnectionInterrupted = useCallback((): void => {
		setStateReady(false);
		chat.suspend();
		setChatResult(null);
		setServerError(null);
	}, [chat.suspend]);

	const socket = useWatchPartySocket({
		authMode,
		password,
		enabled: sessionRequested,
		preferredName: chat.name,
		preferredProfile: chat.profile,
		onMessage: handleServerMessage,
		onAuthenticationFailed: handleAuthenticationFailed,
		onAuthenticationLost: handleAuthenticationLost,
		onConnectionInterrupted: handleConnectionInterrupted
	});

	const status = serverError ?? socket.status;
	const controlsReady = socket.authenticated && stateReady && chat.ready;

	function authenticate(nextPassword: string): void {
		notifications.reset();
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
		if (!controlsReady) return;
		setServerError(null);
		socket.send(message);
	}

	function leave(): void {
		notifications.clear();
		socket.leave();
		setSessionRequested(false);
		setStreamState(null);
		setListenerCount(0);
		setRole('viewer');
		setServerError(null);
		chat.clear();
	}

	return (
		<main className={`app-shell${sessionRequested && hasJoined && viewing.preferences.theater ? ' theater-mode' : ''}`}>
			<RoomHeader
				status={status}
				listenerCount={listenerCount}
				onLeave={sessionRequested ? leave : undefined}
			/>

			{sessionRequested && hasJoined ? (
				<div className="room-content">
					<section className="layout" aria-label="Watch room">
						<PlayerPanel role={role} state={streamState} connected={controlsReady} onSend={send} onStatusChange={setServerError}
							preferences={viewing.preferences} onToggleTheater={viewing.toggleTheater}
							settings={<WatchSettings preferences={viewing.preferences} onChange={viewing.updatePreferences} notificationsEnabled={notifications.enabled} onToggleNotifications={notifications.toggle} />}>
							<ChatPanel
								messages={chat.messages}
								name={chat.name}
								profile={chat.profile}
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
								onProfileChange={(name, profile) => {
									setServerError(null);
									return socket.send({ type: 'set_profile', name, profile });
								}}
							/>
						</PlayerPanel>
					</section>
					<fieldset className="support-band" aria-label="Requests and queue" disabled={!controlsReady}>
						<div className="request-support">
							<RequestVideoPanel mode={authMode} password={password} disabled={!controlsReady} onSend={send} onStatusChange={setServerError} />
							<RequestsPanel role={role} requests={streamState?.requests ?? []} onSend={send} />
						</div>
						<PlaylistPanel
							role={role}
							playlist={streamState?.playlist ?? []}
							currentIndex={streamState?.currentIndex ?? 0}
							onSend={send}
						/>
					</fieldset>
				</div>
			) : (
				<AuthPanel mode={authMode} status={status} onAuthenticate={authenticate} />
			)}
		</main>
	);
}
