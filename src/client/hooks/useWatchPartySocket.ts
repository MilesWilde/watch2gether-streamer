import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '../../stream/messages';
import { isChatRequestId } from '../../stream/messages';
import type { UserRole } from '../../stream/playlist';
import { isChatMessage, isChatSnapshot } from '../lib/chatStorage';
import { isChatProfile, type ChatProfile } from '../../stream/chat-profile';
import { resetServerClock, sampleServerClock } from '../lib/serverClock';

const HEARTBEAT_TIMEOUT_MS = 20_000;

type UseWatchPartySocketOptions = {
	authMode: UserRole;
	password: string;
	enabled: boolean;
	preferredName?: string;
	preferredProfile?: ChatProfile;
	onMessage: (message: ServerMessage) => void;
	onAuthenticationFailed: (message: string) => void;
	onAuthenticationLost: () => void;
	onConnectionInterrupted?: () => void;
};

export function useWatchPartySocket(options: UseWatchPartySocketOptions) {
	const { authMode, password, enabled } = options;
	const optionsRef = useRef(options);
	optionsRef.current = options;
	const socketRef = useRef<WebSocket | null>(null);
	const authenticatedRef = useRef(false);
	const leaveRef = useRef<() => void>(() => {});
	const [authenticated, setAuthenticated] = useState(false);
	const [status, setStatus] = useState('Locked');

	const send = useCallback((message: ClientMessage): boolean => {
		const socket = socketRef.current;
		if (!authenticatedRef.current || !socket || socket.readyState !== WebSocket.OPEN) return false;
		try { socket.send(JSON.stringify(message)); return true; } catch { return false; }
	}, []);
	const leave = useCallback(() => { leaveRef.current(); }, []);

	useEffect(() => {
		if (!enabled || !password) return;
		let disposed = false;
		let suspended = false;
		let reconnectTimer: number | undefined;
		let pingTimer: number | undefined;
		let connectionTimeout: number | undefined;
		let connectionAttempt = 0;
		let reconnectAttempt = 0;

		function stopTimers(): void {
			window.clearTimeout(reconnectTimer);
			window.clearInterval(pingTimer);
			window.clearTimeout(connectionTimeout);
			reconnectTimer = undefined;
			pingTimer = undefined;
			connectionTimeout = undefined;
		}
		function loseAuthentication(interrupted: boolean): void {
			authenticatedRef.current = false;
			setAuthenticated(false);
			if (interrupted && optionsRef.current.onConnectionInterrupted) optionsRef.current.onConnectionInterrupted();
			else optionsRef.current.onAuthenticationLost();
		}
		function closeCurrent(interrupted = false, explicitLeave = false): void {
			stopTimers();
			const socket = socketRef.current;
			socketRef.current = null;
			loseAuthentication(interrupted);
			if (explicitLeave) socket?.close(1000, 'User left room');
			else socket?.close();
		}
		function connect(): void {
			if (disposed || suspended) return;
			stopTimers();
			resetServerClock();
			const startedAt = Date.now();
			const attempt = ++connectionAttempt;
			const retry = reconnectAttempt;
			let lastPongAt: number | null = null;
			let pendingPingAt: number | null = null;
			let closeLogged = false;
			function log(event: string, details: Record<string, unknown> = {}, warning = false): void {
				const now = Date.now();
				console[warning ? 'warn' : 'info']('[watchparty:socket]', {
					timestamp: new Date(now).toISOString(), event, connectionAttempt: attempt,
					reconnectAttempt: retry, durationMs: now - startedAt,
					lastPongAgeMs: lastPongAt === null ? null : now - lastPongAt, ...details,
				});
			}
			log('connect');
			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
			socketRef.current = socket;
			setStatus('Connecting...');
			const active = () => !disposed && !suspended && socketRef.current === socket;
			function retryConnection(cause: string): void {
				if (!active()) return;
				log(cause, {}, true);
				closeCurrent(true);
				setStatus('Connection interrupted. Reconnecting...');
				reconnectAttempt++;
				log('reconnect_scheduled', { reconnectAttempt, delayMs: 1000 });
				reconnectTimer = window.setTimeout(connect, 1000);
			}
			function heartbeat(): void {
				if (!active()) return;
				if (pendingPingAt !== null && performance.now() - pendingPingAt >= HEARTBEAT_TIMEOUT_MS) {
					retryConnection('heartbeat_timeout');
					return;
				}
				// One outstanding ping lets its pong supply an unambiguous RTT.
				if (pendingPingAt === null) {
					pendingPingAt = performance.now();
					if (!send({ type: 'ping' })) retryConnection('heartbeat_send_failed');
				}
			}
			connectionTimeout = window.setTimeout(() => retryConnection('authentication_timeout'), HEARTBEAT_TIMEOUT_MS);
			socket.addEventListener('open', () => {
				if (!active()) return;
				log('open');
				const name = optionsRef.current.preferredName;
				const profile = optionsRef.current.preferredProfile;
				socket.send(JSON.stringify({ type: 'authenticate', mode: authMode, password, ...(name ? { name } : {}), ...(profile ? { profile } : {}) }));
			});
			socket.addEventListener('message', event => {
				if (!active()) return;
				const message = parseServerMessage(event.data);
				if (!message) { log('invalid_message', {}, true); setStatus('Invalid server message'); return; }
				if (message.type === 'authenticated') {
					window.clearTimeout(connectionTimeout);
					connectionTimeout = undefined;
					sampleServerClock(message.serverNowMs);
					reconnectAttempt = 0;
					log('authenticated');
					authenticatedRef.current = true;
					setAuthenticated(true);
					setStatus('Connected');
					window.clearInterval(pingTimer);
					heartbeat();
					if (!active()) return;
					pingTimer = window.setInterval(heartbeat, 5000);
				} else if (message.type === 'error') {
					log('server_error', { authenticationError: isAuthenticationError(message) }, true);
					setStatus(message.message);
					if (isAuthenticationError(message)) {
						closeCurrent();
						optionsRef.current.onAuthenticationFailed(message.message);
					}
				} else if (!authenticatedRef.current) return;
				if (message.type === 'pong') {
					lastPongAt = Date.now();
					if (pendingPingAt !== null) sampleServerClock(message.serverNowMs, performance.now() - pendingPingAt);
					pendingPingAt = null;
				}
				optionsRef.current.onMessage(message);
			});
			socket.addEventListener('close', event => {
				// Error handling invalidates the socket before its close metadata arrives.
				if (!closeLogged) {
					closeLogged = true;
					log('close', {
						code: event.code, wasClean: event.wasClean,
						reason: event.reason === 'User left room' ? event.reason : event.reason ? '[redacted]' : '',
					}, event.code !== 1000);
				}
				if (!active()) return;
				closeCurrent(true);
				setStatus('Disconnected. Reconnecting...');
				reconnectAttempt++;
				log('reconnect_scheduled', { reconnectAttempt, delayMs: 1000 });
				reconnectTimer = window.setTimeout(connect, 1000);
			});
			socket.addEventListener('error', () => {
				if (!active()) return;
				log('error', {}, true);
				// A failed initial handshake must follow the same retry path as a disconnect.
				closeCurrent(true);
				setStatus('Connection error. Reconnecting...');
				reconnectAttempt++;
				log('reconnect_scheduled', { reconnectAttempt, delayMs: 1000 });
				reconnectTimer = window.setTimeout(connect, 1000);
			});
		}
		function pagehide(): void { suspended = true; closeCurrent(true); }
		function pageshow(): void {
			if (!suspended || disposed) return;
			suspended = false;
			connect();
		}
		leaveRef.current = () => {
			if (disposed) return;
			send({ type: 'leave' });
			disposed = true;
			closeCurrent(false, true);
			setStatus('Locked');
		};
		window.addEventListener('pagehide', pagehide);
		window.addEventListener('pageshow', pageshow);
		connect();
		return () => {
			disposed = true;
			closeCurrent();
			window.removeEventListener('pagehide', pagehide);
			window.removeEventListener('pageshow', pageshow);
		};
	}, [authMode, enabled, password, send]);

	return { authenticated, status, send, leave };
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
	try {
		const parsed: unknown = JSON.parse(String(raw));
		return isServerMessage(parsed) ? parsed : null;
	} catch { return null; }
}

export function isAuthenticationError(message: { message: string; code?: string }): boolean {
	return message.code === 'authentication' || message.message === 'Not authenticated' ||
		message.message === 'Invalid stream password' || message.message === 'Invalid admin password' ||
		message.message.startsWith('Stream password is not configured.') || message.message.startsWith('Admin password is not configured.');
}

function isServerMessage(value: unknown): value is ServerMessage {
	if (!value || typeof value !== 'object' || !('type' in value)) return false;
	const message = value as Record<string, unknown>;
	switch (message.type) {
		case 'authenticated': return (message.role === 'viewer' || message.role === 'admin') && typeof message.listenerCount === 'number' && typeof message.serverNowMs === 'number' && Number.isFinite(message.serverNowMs) &&
			(message.senderId === undefined || (typeof message.senderId === 'string' && message.senderId.trim().length > 0 && message.senderId.length <= 200));
		case 'presence': return typeof message.listenerCount === 'number';
		case 'state': return typeof message.state === 'object' && message.state !== null;
		case 'pong': return typeof message.serverNowMs === 'number' && Number.isFinite(message.serverNowMs);
		case 'error': return typeof message.message === 'string';
		case 'chat_history': return isChatSnapshot(message.chat) && message.chat.messages.length <= 500;
		case 'chat_message': return isChatMessage(message.message);
		case 'chat_result': return isChatRequestId(message.requestId) && typeof message.accepted === 'boolean' && (message.message === undefined || typeof message.message === 'string');
		case 'name_updated': return typeof message.name === 'string' && message.name.trim().length > 0 && Array.from(message.name).length <= 40 &&
			(message.profile === undefined || isChatProfile(message.profile));
		default: return false;
	}
}
