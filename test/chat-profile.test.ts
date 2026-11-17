import { describe, expect, it } from 'vitest';
import { createDefaultChatProfile, isChatProfile, parseChatProfile, ROBOT_PARTS, ROBOT_COLORS, PROFILE_BACKGROUNDS, NAME_COLORS } from '../src/stream/chat-profile';

describe('bounded robot profiles', () => {
	it('returns independent valid defaults', () => {
		const first = createDefaultChatProfile();
		const second = createDefaultChatProfile();
		expect(first).toEqual(second);
		expect(first).not.toBe(second);
		expect(isChatProfile(first)).toBe(true);
	});
	it('accepts every offered part and color', () => {
		for (const [field, choices] of Object.entries(ROBOT_PARTS)) {
			for (const choice of choices) expect(parseChatProfile({ ...createDefaultChatProfile(), [field]: choice })?.[field as keyof typeof ROBOT_PARTS]).toBe(choice);
		}
		for (const [field, choices] of [['robotColor', ROBOT_COLORS], ['backgroundColor', PROFILE_BACKGROUNDS], ['nameColor', NAME_COLORS]] as const) {
			for (const choice of choices) expect(parseChatProfile({ ...createDefaultChatProfile(), [field]: choice.value })?.[field]).toBe(choice.value);
		}
	});
	it('rejects malformed profiles and arbitrary markup, URLs and colors', () => {
		for (const input of [null, [], 3, 'robot', {}, { ...createDefaultChatProfile(), eyes: '<svg onload=alert(1)>' }, { ...createDefaultChatProfile(), robotColor: 'url(https://evil.test)' }, { ...createDefaultChatProfile(), nameColor: '000000' }, { ...createDefaultChatProfile(), top: 'x'.repeat(10000) }]) {
			expect(parseChatProfile(input)).toBeNull();
			expect(isChatProfile(input)).toBe(false);
		}
	});
	it('projects only owned profile options and never accepts executable getters', () => {
		const profile = createDefaultChatProfile();
		expect(parseChatProfile({ ...profile, id: 'forged', avatarUrl: 'https://evil.test', svg: '<svg/>' })).toEqual(profile);
		expect(parseChatProfile(Object.create(profile))).toBeNull();
		const getter = Object.defineProperty({ ...profile }, 'eyes', { get() { throw Error('Do not run'); } });
		expect(() => parseChatProfile(getter)).not.toThrow();
		expect(parseChatProfile(getter)).toBeNull();
	});
	it('offers readable name colors on the chat background', () => {
		function luminance(hex: string) {
			const parts = hex.match(/../g)!.map(part => parseInt(part, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
			return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722;
		}
		for (const color of NAME_COLORS) expect((luminance(color.value) + 0.05) / (luminance('1b1e23') + 0.05)).toBeGreaterThanOrEqual(4.5);
	});
});
