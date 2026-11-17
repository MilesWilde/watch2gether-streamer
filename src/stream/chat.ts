import { isChatGifId } from "./chat-gif-id";
import type { ChatProfile } from "./chat-profile";

export const MAX_CHAT_MESSAGES = 500;
export const MAX_CHAT_NAME_LENGTH = 40;
export const MAX_CHAT_MESSAGE_LENGTH = 2000;

export type ChatMessage = {
	id: string;
	sessionId: string;
	senderId?: string;
	name: string;
	profile?: ChatProfile;
	text: string;
	gifId?: string;
	sentAtMs: number;
};

export type ChatSnapshot = { sessionId: string; messages: ChatMessage[] };

export function createChatSnapshot(): ChatSnapshot {
	return { sessionId: crypto.randomUUID(), messages: [] };
}

export function normalizeChatName(value: unknown): string {
	if (typeof value !== "string") return "Guest";
	const name = value.normalize("NFC")
		.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
		.replace(/\s+/g, " ").trim();
	return Array.from(name).slice(0, MAX_CHAT_NAME_LENGTH).join("").trim() || "Guest";
}

export function parseChatInput(text: unknown, gifId: unknown): { text: string; gifId?: string } | null {
	if (typeof text !== "string" || Array.from(text).length > MAX_CHAT_MESSAGE_LENGTH) return null;
	if (gifId !== undefined && !isChatGifId(gifId)) return null;
	const normalized = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "").trim();
	if (!normalized && gifId === undefined) return null;
	return { text: normalized, ...(typeof gifId === "string" ? { gifId } : {}) };
}
