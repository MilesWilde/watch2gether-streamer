import { useCallback, useMemo, useState } from "react";
import type { ClientMessage, ServerMessage } from "../stream/messages";
import type { StreamState, UserRole } from "../stream/playlist";
import { AuthPanel } from "./components/AuthPanel";
import { PlaylistPanel } from "./components/PlaylistPanel";
import { PlayerPanel } from "./components/PlayerPanel";
import { RequestVideoPanel } from "./components/RequestVideoPanel";
import { RequestsPanel } from "./components/RequestsPanel";
import { RoomHeader } from "./components/RoomHeader";
import { useWatchPartySocket } from "./hooks/useWatchPartySocket";

export function WatchPartyApp() {
	const authMode = useMemo<UserRole>(
		() => (window.location.pathname === "/admin" ? "admin" : "viewer"),
		[]
	);
	const [password, setPassword] = useState("");
	const [role, setRole] = useState<UserRole>("viewer");
	const [listenerCount, setListenerCount] = useState(0);
	const [streamState, setStreamState] = useState<StreamState | null>(null);
	const [serverError, setServerError] = useState<string | null>(null);
	const [sessionRequested, setSessionRequested] = useState(false);

	const handleServerMessage = useCallback((message: ServerMessage): void => {
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
			case "pong":
				break;
		}
	}, []);

	const socket = useWatchPartySocket({
		authMode,
		password,
		enabled: sessionRequested,
		onMessage: handleServerMessage,
		onAuthenticationLost: () => {
			setRole("viewer");
		}
	});

	const status = serverError ?? socket.status;

	function authenticate(nextPassword: string): void {
		setPassword(nextPassword);
		setServerError(null);
		setSessionRequested(true);
	}

	function send(message: ClientMessage): void {
		socket.send(message);
	}

	return (
		<main className="app-shell">
			<RoomHeader status={status} listenerCount={listenerCount} />

			{socket.authenticated ? (
				<section className="layout">
					<PlayerPanel
						role={role}
						state={streamState}
						onSend={send}
						onStatusChange={setServerError}
					/>

					<aside className="sidebar">
						<RequestVideoPanel onSend={send} />
						<RequestsPanel role={role} requests={streamState?.requests ?? []} onSend={send} />
						<PlaylistPanel
							role={role}
							playlist={streamState?.playlist ?? []}
							currentIndex={streamState?.currentIndex ?? 0}
							onSend={send}
						/>
					</aside>
				</section>
			) : (
				<AuthPanel mode={authMode} status={status} onAuthenticate={authenticate} />
			)}
		</main>
	);
}
