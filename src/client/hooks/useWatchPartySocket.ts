import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '../../stream/messages';
import { isChatRequestId } from '../../stream/messages';
import type { UserRole } from '../../stream/playlist';
import { isChatMessage, isChatSnapshot } from '../lib/chatStorage';

type UseWatchPartySocketOptions = {
	authMode: UserRole;
	password: string;
	enabled: boolean;
	preferredName?: string;
	onMessage: (message: ServerMessage) => void;
	onAuthenticationFailed: (message: string) => void;
	onAuthenticationLost: () => void;
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

		function stopTimers(): void {
			window.clearTimeout(reconnectTimer);
			window.clearInterval(pingTimer);
			reconnectTimer = undefined;
			pingTimer = undefined;
		}
		function loseAuthentication(): void {
			authenticatedRef.current = false;
			setAuthenticated(false);
			optionsRef.current.onAuthenticationLost();
		}
		function closeCurrent(): void {
			stopTimers();
			const socket = socketRef.current;
			socketRef.current = null;
			loseAuthentication();
			socket?.close();
		}
		function connect(): void {
			if (disposed || suspended) return;
			stopTimers();
			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
			socketRef.current = socket;
			setStatus('Connecting...');
			const active = () => !disposed && !suspended && socketRef.current === socket;
			socket.addEventListener('open', () => {
				if (!active()) return;
				const name = optionsRef.current.preferredName;
				socket.send(JSON.stringify({ type: 'authenticate', mode: authMode, password, ...(name ? { name } : {}) }));
			});
			socket.addEventListener('message', event => {
				if (!active()) return;
				const message = parseServerMessage(event.data);
				if (!message) { setStatus('Invalid server message'); return; }
				if (message.type === 'authenticated') {
					authenticatedRef.current = true;
					setAuthenticated(true);
					setStatus('Connected');
					window.clearInterval(pingTimer);
					pingTimer = window.setInterval(() => send({ type: 'ping' }), 5000);
				} else if (message.type === 'error') {
					setStatus(message.message);
					if (isAuthenticationError(message)) {
						closeCurrent();
						optionsRef.current.onAuthenticationFailed(message.message);
					}
				} else if (!authenticatedRef.current) return;
				optionsRef.current.onMessage(message);
			});
			socket.addEventListener('close', () => {
				if (!active()) return;
				closeCurrent();
				setStatus('Disconnected. Reconnecting...');
				reconnectTimer = window.setTimeout(connect, 1000);
			});
			socket.addEventListener('error', () => {
				if (!active()) return;
				// A failed initial handshake must follow the same retry path as a disconnect.
				closeCurrent();
				setStatus('Connection error. Reconnecting...');
				reconnectTimer = window.setTimeout(connect, 1000);
			});
		}
		function pagehide(): void { suspended = true; closeCurrent(); }
		function pageshow(): void {
			if (!suspended || disposed) return;
			suspended = false;
			connect();
		}
		leaveRef.current = () => { disposed = true; closeCurrent(); setStatus('Locked'); };
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
		case 'authenticated': return (message.role === 'viewer' || message.role === 'admin') && typeof message.listenerCount === 'number' && typeof message.serverNowMs === 'number';
		case 'presence': return typeof message.listenerCount === 'number';
		case 'state': return typeof message.state === 'object' && message.state !== null;
		case 'pong': return typeof message.serverNowMs === 'number';
		case 'error': return typeof message.message === 'string';
		case 'chat_history': return isChatSnapshot(message.chat) && message.chat.messages.length <= 500;
		case 'chat_message': return isChatMessage(message.message);
		case 'chat_result': return isChatRequestId(message.requestId) && typeof message.accepted === 'boolean' && (message.message === undefined || typeof message.message === 'string');
		case 'name_updated': return typeof message.name === 'string' && message.name.trim().length > 0 && Array.from(message.name).length <= 40;
		default: return false;
	}
}
