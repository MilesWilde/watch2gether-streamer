import { createDefaultChatProfile, parseChatProfile, type ChatProfile } from '../../stream/chat-profile';

type ProfileStorage = Pick<Storage, 'getItem' | 'setItem'> | null;
const profileKey = 'watchparty-profile:global';

export function readPreferredProfile(storage: ProfileStorage): ChatProfile {
	try {
		const raw = storage?.getItem(profileKey);
		if (!raw || raw.length > 4096) return createDefaultChatProfile();
		const value: unknown = JSON.parse(raw);
		if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('profile' in value)) return createDefaultChatProfile();
		return parseChatProfile(value.profile) ?? createDefaultChatProfile();
	} catch { return createDefaultChatProfile(); }
}

export function writePreferredProfile(storage: ProfileStorage, profile: ChatProfile): void {
	const safe = parseChatProfile(profile);
	if (!safe) return;
	try { storage?.setItem(profileKey, JSON.stringify({ version: 1, profile: safe })); } catch { /* Storage is optional. */ }
}
