import catalog from '../../public/emotes/catalog.json';

export type ChatEmotePackId = 'openmoji' | 'twemoji' | 'neocat';
export type ChatEmotePack = {
	id: ChatEmotePackId;
	name: string;
	version: string;
	sourceUrl: string;
	license: string;
	licenseUrl: string;
	credit: string;
	licenseFile: string;
	archiveUrl?: string;
	archiveSha256?: string;
};

export type ChatEmote = {
	id: string;
	label: string;
	url: string;
	aliases: string[];
	tags: string[];
	pack: ChatEmotePackId;
	codepoint: string;
	author: string;
};

export const CHAT_EMOTE_PACKS = catalog.packs as ChatEmotePack[];
export const CHAT_EMOTES = catalog.assets as ChatEmote[];

export function getChatEmote(id: unknown): ChatEmote | undefined {
	return typeof id === "string" ? CHAT_EMOTES.find((emote) => emote.id === id) : undefined;
}

export type ChatEmoteToken = { type: "text"; text: string } | { type: "emote"; emote: ChatEmote };

export function tokenizeChatEmotes(text: string): ChatEmoteToken[] {
	const tokens: ChatEmoteToken[] = [];
	let cursor = 0;
	for (const match of text.matchAll(/:([a-z0-9_]+):/g)) {
		const emote = getChatEmote(match[1]);
		if (!emote) continue;
		if (match.index > cursor) tokens.push({ type: "text", text: text.slice(cursor, match.index) });
		tokens.push({ type: "emote", emote });
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) tokens.push({ type: "text", text: text.slice(cursor) });
	return tokens;
}
