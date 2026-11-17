import { CHAT_EMOJI } from '../../stream/chat-media';
import { CHAT_EMOTES } from '../../stream/chat-emotes';
import { searchChatMedia } from '../../stream/chat-media';

export type Reaction = { id: string; value: string; label: string; url?: string; pack: string; tags: string[]; aliases: string[] };
export type EmojiQuery = { start: number; end: number; query: string };

const groups = [
	['happy smile laugh celebration', '😀 😃 😄 😁 😆 😅 😂 🤣 😊 🙂 😉 😎 🤩 🥳 🎉 🎊'],
	['love heart affection hug kiss', '😍 🥰 😘 🥹 🥺 🤗 🫶 ❤️ 🧡 💛 💚 💙 💜 🩷 🤍 💕 💖 💗 💞'],
	['funny chaos silly surprise shocked thinking', '🙃 😋 🤔 😮 😲 🤭'],
	['sad cry tired sleepy cozy', '😭 😴 😌 🌙 ☕ 🧋'],
	['hello wave yes hands support applause', '👋 👍 👏 🙌 🤝 ✌️'],
	['animal cute pet', '🐱 🐶 🐰 🐻 🐼 🦊 🐸 🐹 🐨 🐥'],
	['bug insect caterpillar ladybug butterfly bee', '🐛 🐞 🦋 🐝'],
	['nature flower sunshine rainbow sparkle star', '🌸 🌷 🌻 🍀 🌈 ⭐ ✨ ☀️ 🌙'],
	['music video movie cinema popcorn', '🎶 🎵 🎬 🍿'],
	['food snack fruit dessert sweet coffee tea', '🍓 🍒 🍑 🍪 🍩 🧁 🍰 ☕ 🧋'],
] as const;

const artworkByCodepoint = new Map(CHAT_EMOTES.filter(emote => emote.pack === 'openmoji').map(emote => [
	emote.codepoint.toUpperCase().split('-').filter(point => point !== 'FE0F').join('-'), emote,
]));

export const UNICODE_REACTIONS: Reaction[] = CHAT_EMOJI.map(emoji => {
	const points = Array.from(emoji, character => character.codePointAt(0)!.toString(16));
	const artwork = artworkByCodepoint.get(points.map(point => point.toUpperCase()).filter(point => point !== 'FE0F').join('-'));
	return {
		id: `unicode-${points.join('-')}`,
		value: emoji,
		label: emoji,
		pack: 'unicode',
		tags: groups.filter(([, members]) => members.split(' ').includes(emoji)).flatMap(([tags]) => tags.split(' ')),
		aliases: artwork ? [artwork.label, ...artwork.aliases, ...artwork.tags] : [],
	};
});

export const REACTIONS: Reaction[] = [
	...UNICODE_REACTIONS,
	...CHAT_EMOTES.map(emote => ({ ...emote, value: `:${emote.id}:` })),
];

export function searchReactions(query: string, limit = 8): Reaction[] {
	return searchChatMedia(REACTIONS, query).slice(0, Math.max(0, Math.min(200, limit)));
}

export function getEmojiQuery(text: string, start: number, end = start): EmojiQuery | null {
	if (start !== end || start < 0 || start > text.length) return null;
	const match = /(?:^|[\s(\[{])(:([a-z][a-z0-9_+-]{0,63}))$/i.exec(text.slice(0, start));
	if (!match) return null;
	const tail = /^[a-z0-9_+-]*:?/i.exec(text.slice(start))![0];
	return { start: start - match[1].length, end: start + tail.length, query: match[2] };
}

export function replaceEmojiQuery(text: string, token: EmojiQuery, value: string): { text: string; caret: number } {
	return { text: text.slice(0, token.start) + value + text.slice(token.end), caret: token.start + value.length };
}

export function searchEmoji(query: string): string[] {
	return searchChatMedia(UNICODE_REACTIONS, query).map(reaction => reaction.value);
}
