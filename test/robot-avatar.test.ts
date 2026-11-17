import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAvatar } from '@dicebear/core';
import * as bottts from '@dicebear/bottts';
import { RobotAvatar } from '../src/client/components/RobotAvatar';
import { robotAvatarDataUri, randomizeChatProfile } from '../src/client/lib/robotAvatar';
import { mixedAvatarSvg } from '../src/client/lib/mixedAvatar';
import { createDefaultChatProfile, isChatProfile, ROBOT_PARTS, type ChatProfile } from '../src/stream/chat-profile';

type MemoInstance = { slots: { deps: readonly unknown[]; value: unknown }[]; index: number };
const hooks = vi.hoisted(() => ({ current: null as MemoInstance | null }));
vi.mock('react', async original => ({
	...await original<typeof import('react')>(),
	useMemo: (factory: () => unknown, deps: readonly unknown[]) => {
		const instance = hooks.current;
		if (!instance) return factory();
		const index = instance.index++;
		const previous = instance.slots[index];
		if (!previous || deps.length !== previous.deps.length || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
			instance.slots[index] = { deps: [...deps], value: factory() };
		}
		return instance.slots[index].value;
	},
}));
vi.mock('@dicebear/core', async original => {
	const core = await original<typeof import('@dicebear/core')>();
	return { ...core, createAvatar: vi.fn(core.createAvatar) };
});
vi.mock('../src/client/lib/mixedAvatar', async original => {
	const mixed = await original<typeof import('../src/client/lib/mixedAvatar')>();
	return { ...mixed, mixedAvatarSvg: vi.fn(mixed.mixedAvatarSvg) };
});

function renderAvatar(instance: MemoInstance, props: Parameters<typeof RobotAvatar>[0]) {
	hooks.current = instance;
	instance.index = 0;
	try { return RobotAvatar(props); }
	finally { hooks.current = null; }
}

describe('local Bottts avatars', () => {
	it('renders a genuine deterministic local SVG with fixed dimensions', () => {
		const uri = robotAvatarDataUri(createDefaultChatProfile());
		expect(uri).toMatch(/^data:image\/svg\+xml;/);
		const svg = decodeURIComponent(uri.slice(uri.indexOf(',') + 1));
		expect(svg).toContain('<svg');
		expect(svg).toContain('<path');
		expect(svg).not.toMatch(/<script|<foreignObject|<image|(?:href|src)=["']https?:/);
		expect(robotAvatarDataUri({ ...createDefaultChatProfile() })).toBe(uri);
		const html = renderToStaticMarkup(createElement(RobotAvatar, {}));
		expect(html).toContain('width="36"');
		expect(html).toContain('height="36"');
		expect(html).toContain('alt=""');
		expect(html).toContain('data:image/svg+xml;');
		const labeled = renderToStaticMarkup(createElement(RobotAvatar, { size: 88, alt: 'Profile avatar', className: 'preview' }));
		expect(labeled).toContain('width="88"');
		expect(labeled).toContain('height="88"');
		expect(labeled).toContain('alt="Profile avatar"');
		expect(labeled).toContain('robot-avatar preview');
	});
	it('honors every part including explicit absent top and sides', () => {
		const profile = createDefaultChatProfile();
		for (const key of Object.keys(ROBOT_PARTS) as (keyof typeof ROBOT_PARTS)[]) {
			const variants = ROBOT_PARTS[key].map(value => robotAvatarDataUri({ ...profile, [key]: value }));
			expect(new Set(variants).size).toBe(variants.length);
		}
		const absent = { ...profile, top: 'none', sides: 'none' } as const;
		expect(robotAvatarDataUri(absent)).toBe(createAvatar(bottts, {
			seed: 'watchparty-bottts-v1', face: [profile.face], eyes: [profile.eyes], mouth: [profile.mouth],
			mouthProbability: 100, top: ['antenna'], topProbability: 0,
			sides: ['antenna01'], sidesProbability: 0, textureProbability: 0,
			baseColor: [profile.robotColor], backgroundColor: [profile.backgroundColor],
		}).toDataUri());
	});
	it('falls back for unknown profiles and discards arbitrary SVG and URL input', () => {
		const fallback = robotAvatarDataUri(undefined);
		for (const input of [null, {}, 'https://evil.test/a.svg', '<svg onload="alert(1)"/>', { ...createDefaultChatProfile(), robotColor: 'url(evil)' }]) {
			expect(robotAvatarDataUri(input)).toBe(fallback);
		}
		const getter = Object.defineProperty({}, 'face', { get() { throw Error('unsafe'); } });
		expect(robotAvatarDataUri(getter)).toBe(fallback);
	});
	it('changes robot and background colors but does not encode name color in the avatar', () => {
		const profile = createDefaultChatProfile();
		const uri = robotAvatarDataUri(profile);
		expect(robotAvatarDataUri({ ...profile, robotColor: '8ac6ff' })).not.toBe(uri);
		expect(robotAvatarDataUri({ ...profile, backgroundColor: '3c3542' })).not.toBe(uri);
		expect(robotAvatarDataUri({ ...profile, nameColor: 'a9d8ff' })).toBe(uri);
	});
	it('randomizes only approved scalar choices, including both none choices', () => {
		for (let i = 0; i < 100; i++) expect(isChatProfile(randomizeChatProfile())).toBe(true);
		const first = randomizeChatProfile(() => 0);
		const last = randomizeChatProfile(() => 0.999999);
		expect(first.top).toBe('none');
		expect(first.sides).toBe('none');
		expect(first).not.toEqual(last);
		expect(Object.keys(first).sort()).toEqual(Object.keys(createDefaultChatProfile()).sort());
	});
	it('retains per-instance SVGs beyond the shared cache limit across draft and equivalent-profile rerenders', () => {
		const profiles: ChatProfile[] = Array.from({ length: 129 }, (_, i) => ({
			...createDefaultChatProfile(), robotColor: 'e7ebef', backgroundColor: 'dce9e3',
			face: ROBOT_PARTS.face[Math.floor(i / (ROBOT_PARTS.eyes.length * ROBOT_PARTS.mouth.length))],
			eyes: ROBOT_PARTS.eyes[Math.floor(i / ROBOT_PARTS.mouth.length) % ROBOT_PARTS.eyes.length],
			mouth: ROBOT_PARTS.mouth[i % ROBOT_PARTS.mouth.length],
		}));
		const instances: MemoInstance[] = profiles.map(() => ({ slots: [], index: 0 }));
		vi.mocked(createAvatar).mockClear();
		vi.mocked(mixedAvatarSvg).mockClear();
		const renderCount = () => vi.mocked(createAvatar).mock.calls.length + vi.mocked(mixedAvatarSvg).mock.calls.length;
		const sources = profiles.map((profile, i) => renderAvatar(instances[i], { profile }).props.src);
		expect(new Set(sources).size).toBe(129);
		expect(renderCount()).toBe(129);
		for (let pass = 0; pass < 3; pass++) {
			profiles.forEach((profile, i) => {
				expect(renderAvatar(instances[i], { profile }).props.src).toBe(sources[i]);
			});
			expect(renderCount()).toBe(129);
			profiles.forEach((profile, i) => {
				expect(renderAvatar(instances[i], { profile: { ...profile }, size: 48, alt: 'Renamed' }).props.src).toBe(sources[i]);
			});
			expect(renderCount()).toBe(129);
		}
		const recoloredName = renderAvatar(instances[0], { profile: { ...profiles[0], nameColor: 'a9d8ff' } });
		expect(recoloredName.props.src).toBe(sources[0]);
		expect(renderCount()).toBe(129);
		const changed = renderAvatar(instances[0], { profile: { ...profiles[0], backgroundColor: '4b3238' } });
		expect(changed.props.src).not.toBe(sources[0]);
		expect(renderCount()).toBe(130);
		// The shared cache still evicts old entries; retained components own their memoized URI.
		expect(robotAvatarDataUri(profiles[0])).toBe(sources[0]);
		expect(renderCount()).toBe(131);
	});
	it('updates the memoized URI when any appearance scalar changes or the profile is removed', () => {
		const instance: MemoInstance = { slots: [], index: 0 };
		const profile = createDefaultChatProfile();
		const original = renderAvatar(instance, { profile }).props.src;
		const changes = [
			{ face: 'round02' }, { eyes: 'hearts' }, { mouth: 'bite' }, { top: 'none' },
			{ sides: 'none' }, { robotColor: 'f5a8d2' }, { backgroundColor: 'f1f4f6' },
		] as const;
		for (const change of changes) {
			renderAvatar(instance, { profile });
			const changedProfile = { ...profile, ...change };
			const changed = renderAvatar(instance, { profile: changedProfile }).props.src;
			expect(changed).not.toBe(original);
			expect(changed).toBe(robotAvatarDataUri(changedProfile));
		}
		expect(renderAvatar(instance, {}).props.src).toBe(original);
	});
});
