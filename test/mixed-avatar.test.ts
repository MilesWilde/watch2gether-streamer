import { describe, expect, it } from 'vitest';
import { chatProfilesEqual, createDefaultChatProfile, parseChatProfile } from '../src/stream/chat-profile';
import { robotAvatarDataUri } from '../src/client/lib/robotAvatar';

const mixed = () => ({ ...createDefaultChatProfile(), face: 'cat', mouth: 'proboscis', ears: 'cat', top: 'antenna', wings: 'butterfly', limbs: 'ant', whiskers: 'cat' });
const svg = (value: unknown) => decodeURIComponent(robotAvatarDataUri(value).split(',')[1]);

describe('mixed species avatar parts', () => {
	it('accepts a cat head, ears, proboscis and robot antenna together', () => {
		expect(parseChatProfile(mixed())).toEqual(mixed());
	});
	it('keeps old robots unchanged and treats missing extras as None', () => {
		const old = createDefaultChatProfile();
		expect(parseChatProfile(old)).toEqual(old);
		expect(parseChatProfile({ ...old, ears: 'none', wings: 'none', limbs: 'none', whiskers: 'none' })).toEqual(old);
		expect(chatProfilesEqual(old, { ...old, ears: 'none' } as any)).toBe(true);
	});
	it('rejects unknown extra parts, inherited values, and accessors without invoking them', () => {
		for (const field of ['ears', 'wings', 'limbs', 'whiskers']) {
			expect(parseChatProfile({ ...createDefaultChatProfile(), [field]: '<svg onload=alert(1)>' })).toBeNull();
			const inherited = Object.assign(Object.create({ [field]: 'cat' }), createDefaultChatProfile());
			expect(parseChatProfile(inherited)).toBeNull();
			const accessor = { ...createDefaultChatProfile() };
			Object.defineProperty(accessor, field, { get() { throw Error('Getter executed'); } });
			expect(parseChatProfile(accessor)).toBeNull();
		}
	});
	it('renders every mixed feature as an independent layer in a safe local SVG', () => {
		const image = svg(mixed());
		for (const slot of ['face', 'ears', 'mouth', 'top', 'wings', 'limbs', 'whiskers']) {
			expect(image).toContain(`data-avatar-slot="${slot}"`);
		}
		// SVG's required namespace identifies the document format; it is not fetched.
		// Exclude only that exact root declaration so every other URL remains forbidden.
		expect(image).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
		const artwork = image.replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '<svg');
		expect(artwork).not.toMatch(/<script|<foreignObject|<image|\son[a-z]+\s*=|https?:\/\//i);
		expect(image.indexOf('data-avatar-slot="wings"')).toBeLessThan(image.indexOf('data-avatar-slot="face"'));
		expect(image.indexOf('data-avatar-slot="ears"')).toBeLessThan(image.indexOf('data-avatar-slot="face"'));
	});
	it('changes appearance and grouping when a single extra part changes', () => {
		const first = mixed();
		for (const field of ['ears', 'wings', 'limbs', 'whiskers']) {
			const second = { ...first, [field]: 'none' };
			expect(robotAvatarDataUri(first)).not.toBe(robotAvatarDataUri(second));
			expect(chatProfilesEqual(first as any, second as any)).toBe(false);
		}
	});
});
