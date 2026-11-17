export const ROBOT_PARTS = {
	face: ['round01', 'round02', 'square01', 'square02', 'square03', 'square04', 'cat', 'bug'],
	eyes: ['bulging', 'dizzy', 'eva', 'frame1', 'frame2', 'glow', 'happy', 'hearts', 'robocop', 'round', 'roundFrame01', 'roundFrame02', 'sensor', 'shade01', 'cat', 'bug'],
	mouth: ['bite', 'diagram', 'grill01', 'grill02', 'grill03', 'smile01', 'smile02', 'square01', 'square02', 'none', 'cat', 'proboscis', 'mandibles'],
	top: ['none', 'antenna', 'antennaCrooked', 'bulb01', 'glowingBulb01', 'glowingBulb02', 'horns', 'lights', 'pyramid', 'radar', 'insectAntennae'],
	sides: ['none', 'antenna01', 'antenna02', 'cables01', 'cables02', 'round', 'square', 'squareAssymetric'],
} as const;

export const AVATAR_EXTRAS = {
	ears: ['none', 'cat', 'foldedCat'],
	whiskers: ['none', 'cat'],
	wings: ['none', 'butterfly', 'mosquito'],
	limbs: ['none', 'ant', 'beetle'],
} as const;
export const AVATAR_PARTS = { ...ROBOT_PARTS, ...AVATAR_EXTRAS } as const;

export const ROBOT_COLORS = [
	{ value: '82d6a6', label: 'Mint' }, { value: '8ac6ff', label: 'Sky' },
	{ value: 'f5a8d2', label: 'Pink' }, { value: 'f2d077', label: 'Gold' },
	{ value: 'b7a3ef', label: 'Lilac' }, { value: 'ef9b83', label: 'Coral' },
	{ value: 'b9c4cf', label: 'Silver' }, { value: 'e7ebef', label: 'Pearl' },
] as const;
export const PROFILE_BACKGROUNDS = [
	{ value: '25292f', label: 'Charcoal' }, { value: '33413d', label: 'Forest' },
	{ value: '3c3542', label: 'Plum' }, { value: '343c4d', label: 'Midnight' },
	{ value: '453c30', label: 'Olive' }, { value: '4b3238', label: 'Berry' },
	{ value: 'f1f4f6', label: 'Cloud' }, { value: 'dce9e3', label: 'Mist' },
] as const;
export const NAME_COLORS = [
	{ value: 'bcebd3', label: 'Mint' }, { value: 'a9d8ff', label: 'Sky' },
	{ value: 'f5b6d2', label: 'Pink' }, { value: 'ffc49a', label: 'Peach' },
	{ value: 'f4df8c', label: 'Lemon' }, { value: 'd1bfff', label: 'Lilac' },
	{ value: 'e4e7ed', label: 'Snow' }, { value: 'ffb4ab', label: 'Rose' },
] as const;

export type ChatProfile = {
	[Key in keyof typeof ROBOT_PARTS]: typeof ROBOT_PARTS[Key][number];
} & {
	[Key in keyof typeof AVATAR_EXTRAS]?: typeof AVATAR_EXTRAS[Key][number];
} & {
	robotColor: typeof ROBOT_COLORS[number]['value'];
	backgroundColor: typeof PROFILE_BACKGROUNDS[number]['value'];
	nameColor: typeof NAME_COLORS[number]['value'];
};

export function createDefaultChatProfile(): ChatProfile {
	return { face: 'square01', eyes: 'happy', mouth: 'smile01', top: 'antenna', sides: 'round', robotColor: '82d6a6', backgroundColor: '25292f', nameColor: 'bcebd3' };
}

export function parseChatProfile(value: unknown): ChatProfile | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const choices = {
		...ROBOT_PARTS,
		robotColor: ROBOT_COLORS.map(color => color.value),
		backgroundColor: PROFILE_BACKGROUNDS.map(color => color.value),
		nameColor: NAME_COLORS.map(color => color.value),
	};
	const result = createDefaultChatProfile();
	try {
		for (const key of Object.keys(choices) as (keyof ChatProfile)[]) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string' || !(choices[key as keyof typeof choices] as readonly string[]).includes(descriptor.value)) return null;
			Object.assign(result, { [key]: descriptor.value });
		}
		for (const key of Object.keys(AVATAR_EXTRAS) as (keyof typeof AVATAR_EXTRAS)[]) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor) { if (key in value) return null; continue; }
			if (!('value' in descriptor) || typeof descriptor.value !== 'string' || !(AVATAR_EXTRAS[key] as readonly string[]).includes(descriptor.value)) return null;
			if (descriptor.value !== 'none') Object.assign(result, { [key]: descriptor.value });
		}
		return result;
	} catch { return null; }
}

export function isChatProfile(value: unknown): value is ChatProfile {
	return parseChatProfile(value) !== null;
}

export function chatProfilesEqual(left: ChatProfile | undefined, right: ChatProfile | undefined): boolean {
	const first = left ?? createDefaultChatProfile();
	const second = right ?? createDefaultChatProfile();
	return ([...Object.keys(createDefaultChatProfile()), ...Object.keys(AVATAR_EXTRAS)] as (keyof ChatProfile)[])
		.every(key => (first[key] ?? 'none') === (second[key] ?? 'none'));
}
