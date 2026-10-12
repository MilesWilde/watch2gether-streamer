import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "../../stream/messages";
import type { UserRole } from "../../stream/playlist";

type UseWatchPartySocketOptions = {
	authMode: UserRole;
	password: string;
	enabled: boolean;
	onMessage: (message: ServerMessage) => void;
	onAuthenticationFailed: (message: string) => void;
	onAuthenticationLost: () => void;
};

type UseWatchPartySocketResult = {
	authenticated: boolean;
	status: string;
	send: (message: ClientMessage) => void;
};

export function useWatchPartySocket({
	authMode,
	password,
	enabled,
	onMessage,
	onAuthenticationFailed,
	onAuthenticationLost
}: UseWatchPartySocketOptions): UseWatchPartySocketResult {
	const socketRef = useRef<WebSocket | null>(null);
	const reconnectTimerRef = useRef<number | null>(null);
	const pingTimerRef = useRef<number | null>(null);
	const authenticatedRef = useRef(false);
	const [authenticated, setAuthenticated] = useState(false);
	const [status, setStatus] = useState("Locked");

	const stopPing = useCallback((): void => {
		if (pingTimerRef.current !== null) {
			window.clearInterval(pingTimerRef.current);
			pingTimerRef.current = null;
		}
	}, []);

	const send = useCallback((message: ClientMessage): void => {
		const socket = socketRef.current;

		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}

		socket.send(JSON.stringify(message));
	}, []);

	const startPing = useCallback((): void => {
		stopPing();
		pingTimerRef.current = window.setInterval(() => {
			send({ type: "ping" });
		}, 5000);
	}, [send, stopPing]);

	useEffect(() => {
		if (!enabled || !password) {
			return;
		}

		let disposed = false;

		function clearReconnect(): void {
			if (reconnectTimerRef.current !== null) {
				window.clearTimeout(reconnectTimerRef.current);
				reconnectTimerRef.current = null;
			}
		}

		function setAuthenticatedState(nextAuthenticated: boolean): void {
			authenticatedRef.current = nextAuthenticated;
			setAuthenticated(nextAuthenticated);
		}

		function connect(): void {
			clearReconnect();
			socketRef.current?.close();

			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

			socketRef.current = socket;
			setStatus("Connecting...");

			socket.addEventListener("open", () => {
				send({
					type: "authenticate",
					mode: authMode,
					password
				});
			});

			socket.addEventListener("message", (event) => {
				const message = parseServerMessage(event.data);

				if (!message) {
					setStatus("Invalid server message");
					return;
				}

				if (message.type === "authenticated") {
					setAuthenticatedState(true);
					setStatus("Connected");
					startPing();
				}

				if (message.type === "error") {
					setAuthenticatedState(false);
					stopPing();
					setStatus(message.message);

					if (isAuthenticationError(message.message)) {
						onAuthenticationFailed(message.message);
					}
				}

				onMessage(message);
			});

			socket.addEventListener("close", () => {
				stopPing();

				if (disposed || !authenticatedRef.current) {
					return;
				}

				setAuthenticatedState(false);
				onAuthenticationLost();
				setStatus("Disconnected");
				reconnectTimerRef.current = window.setTimeout(connect, 1000);
			});

			socket.addEventListener("error", () => {
				setStatus("Connection error");
			});
		}

		connect();

		return () => {
			disposed = true;
			clearReconnect();
			stopPing();
			setAuthenticatedState(false);
			socketRef.current?.close();
			socketRef.current = null;
		};
	}, [
		authMode,
		enabled,
		onAuthenticationFailed,
		onAuthenticationLost,
		onMessage,
		password,
		send,
		startPing,
		stopPing
	]);

	return {
		authenticated,
		status,
		send
	};
}

function parseServerMessage(raw: unknown): ServerMessage | null {
	try {
		const parsed: unknown = JSON.parse(String(raw));
		return isServerMessage(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function isAuthenticationError(message: string): boolean {
	return (
		message === "Invalid stream password" ||
		message === "Invalid admin password" ||
		message === "Stream password is not configured. Add ROOM_PASSWORD to .dev.vars and restart Wrangler." ||
		message === "Admin password is not configured. Add ADMIN_PASSWORD to .dev.vars and restart Wrangler."
	);
}

function isServerMessage(value: unknown): value is ServerMessage {
	if (typeof value !== "object" || value === null || !("type" in value)) {
		return false;
	}

	const message = value as Record<string, unknown>;

	switch (message.type) {
		case "authenticated":
			return (
				(message.role === "viewer" || message.role === "admin") &&
				typeof message.listenerCount === "number" &&
				typeof message.serverNowMs === "number"
			);
		case "presence":
			return typeof message.listenerCount === "number";
		case "state":
			return typeof message.state === "object" && message.state !== null;
		case "pong":
			return typeof message.serverNowMs === "number";
		case "error":
			return typeof message.message === "string";
		default:
			return false;
	}
}
