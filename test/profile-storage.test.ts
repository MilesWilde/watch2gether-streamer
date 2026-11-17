import { describe, expect, it } from 'vitest';
import { readPreferredProfile, writePreferredProfile } from '../src/client/lib/profileStorage';
import { createDefaultChatProfile } from '../src/stream/chat-profile';

function storage() {
	const items = new Map<string, string>();
	return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
}
describe('preferred robot profile storage', () => {
	it('round trips a profile in its own versioned preference key', () => {
		const store = storage();
		const profile = { ...createDefaultChatProfile(), eyes: 'hearts' as const, nameColor: 'a9d8ff' as const };
		writePreferredProfile(store, profile);
		expect(readPreferredProfile(store)).toEqual(profile);
		expect(JSON.parse(store.getItem('watchparty-profile:global')!)).toEqual({ version: 1, profile });
	});
	it('returns fresh defaults for absent, invalid, oversized and unsupported-version data', () => {
		const store = storage();
		for (const value of ['', '{', 'x'.repeat(4097), '{}', JSON.stringify({ version: 2, profile: createDefaultChatProfile() }), JSON.stringify({ version: 1, profile: { ...createDefaultChatProfile(), eyes: 'bad' } })]) {
			store.setItem('watchparty-profile:global', value);
			expect(readPreferredProfile(store)).toEqual(createDefaultChatProfile());
		}
		expect(readPreferredProfile(null)).not.toBe(readPreferredProfile(null));
	});
	it('tolerates blocked storage and strips unknown profile fields before saving', () => {
		const blocked = { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Blocked'); } };
		expect(readPreferredProfile(blocked)).toEqual(createDefaultChatProfile());
		expect(() => writePreferredProfile(blocked, createDefaultChatProfile())).not.toThrow();
		const store = storage();
		writePreferredProfile(store, { ...createDefaultChatProfile(), avatarUrl: 'https://evil.test' } as ReturnType<typeof createDefaultChatProfile>);
		expect(store.getItem('watchparty-profile:global')).not.toContain('evil.test');
	});
});
