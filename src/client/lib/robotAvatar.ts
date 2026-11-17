import { createAvatar } from '@dicebear/core';
import * as bottts from '@dicebear/bottts';
import {
	createDefaultChatProfile, parseChatProfile, ROBOT_PARTS, ROBOT_COLORS,
	PROFILE_BACKGROUNDS, NAME_COLORS, type ChatProfile,
} from '../../stream/chat-profile';
import { mixedAvatarSvg, needsMixedAvatar } from './mixedAvatar';

const avatarCache = new Map<string, string>();
const cacheLimit = 128;

export function robotAvatarDataUri(value?: unknown): string {
	const profile = parseChatProfile(value) ?? createDefaultChatProfile();
	const { nameColor: _nameColor, ...appearance } = profile;
	const key = JSON.stringify(appearance);
	const cached = avatarCache.get(key);
	if (cached) return cached;
	const uri = needsMixedAvatar(profile) ? `data:image/svg+xml;utf8,${encodeURIComponent(mixedAvatarSvg(profile))}` : createAvatar(bottts, {
		seed: 'watchparty-bottts-v1',
		face: [profile.face as bottts.Options['face'] extends (infer T)[] | undefined ? T : never],
		eyes: [profile.eyes as bottts.Options['eyes'] extends (infer T)[] | undefined ? T : never],
		mouth: [profile.mouth as bottts.Options['mouth'] extends (infer T)[] | undefined ? T : never], mouthProbability: 100,
		top: [profile.top === 'none' ? 'antenna' : profile.top as bottts.Options['top'] extends (infer T)[] | undefined ? T : never], topProbability: profile.top === 'none' ? 0 : 100,
		sides: [profile.sides === 'none' ? 'antenna01' : profile.sides], sidesProbability: profile.sides === 'none' ? 0 : 100,
		textureProbability: 0, baseColor: [profile.robotColor], backgroundColor: [profile.backgroundColor],
	}).toDataUri();
	if (avatarCache.size >= cacheLimit) avatarCache.delete(avatarCache.keys().next().value!);
	avatarCache.set(key, uri);
	return uri;
}

export function randomizeChatProfile(random: () => number = Math.random): ChatProfile {
	const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
	return {
		face: pick(ROBOT_PARTS.face), eyes: pick(ROBOT_PARTS.eyes), mouth: pick(ROBOT_PARTS.mouth),
		top: pick(ROBOT_PARTS.top), sides: pick(ROBOT_PARTS.sides),
		robotColor: pick(ROBOT_COLORS).value, backgroundColor: pick(PROFILE_BACKGROUNDS).value,
		nameColor: pick(NAME_COLORS).value,
	};
}
