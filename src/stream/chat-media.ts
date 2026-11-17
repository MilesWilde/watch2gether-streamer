import expandedGifs from "./chat-gif-catalog.json";

export type ChatGif = { id: string; label: string; url: string; tags?: string[] };

export const CHAT_GIF_PACK = {
	name: "Animated Noto Emoji",
	sourceUrl: "https://googlefonts.github.io/noto-emoji-files/",
	license: "CC BY 4.0",
	licenseUrl: "https://creativecommons.org/licenses/by/4.0/"
} as const;

export const LEGACY_CHAT_GIFS: ChatGif[] = [
	{ id: "cat-pats", label: "Cat head pats", url: "https://media.giphy.com/media/KztT2c4u8mYYUiMKdJ/200w.gif", tags: ["cute", "love", "cozy", "cat", "comfort"] },
	{ id: "fox-love", label: "Fox love", url: "https://media.giphy.com/media/s6Ru4Jpl7EJkjyjq75/200w.gif", tags: ["cute", "love", "fox", "heart"] },
	{ id: "tiny-chick", label: "Tiny chick", url: "https://media.giphy.com/media/YR0IBYGICPmzehJ6um/200w.gif", tags: ["cute", "happy", "chick", "bird"] },
	{ id: "kitty", label: "Little kitty", url: "https://media.giphy.com/media/3o8dFsCL0z8cgjoWzK/200w.gif", tags: ["cute", "cozy", "cat", "kitten"] },
	{ id: "happy-wave", label: "Happy wave", url: "https://media.giphy.com/media/O0VBge9U7f8j21UqNj/200w.gif", tags: ["happy", "hello", "wave", "cute"] },
	{ id: "summer-cat", label: "Summer cat", url: "https://media.giphy.com/media/TEBseeS5mJCje0NKs9/200w.gif", tags: ["cute", "happy", "cozy", "summer", "cat"] },
	{ id: "love-you", label: "Love you", url: "https://media.giphy.com/media/ViSpZL4Nz52k0fiowe/200w.gif", tags: ["love", "cute", "affection"] },
	{ id: "music-frog", label: "Music frog", url: "https://media.giphy.com/media/6FxJBpNTBgWdJCXKD4/200w.gif", tags: ["happy", "funny", "music", "frog", "dance"] },
	{ id: "happy-heart", label: "Happy heart", url: "https://media.giphy.com/media/D4xeiRd5Kbgds50E3r/200w.gif", tags: ["happy", "love", "heart", "cute"] },
	{ id: "dumpling", label: "Little dumpling", url: "https://media.giphy.com/media/qZy6R9ZfLr4BLthMh5/200w.gif", tags: ["cute", "cozy", "food", "dumpling"] },
	{ id: "melody", label: "My Melody", url: "https://media.giphy.com/media/ts0Uy1zVJTvCo/200w.gif", tags: ["cute", "happy", "cozy", "sanrio"] },
	{ id: "tea-time", label: "Tea time", url: "https://media.giphy.com/media/lS7l4HG3tsAG0k8MoJ/200w.gif", tags: ["cozy", "tea", "relax", "drink"] },
	{ id: "bongo-party", label: "Bongo cat party", url: "https://media.giphy.com/media/mn9Mc2ocSfTGTlp9XT/200w.gif", tags: ["cute", "happy", "chaotic", "music", "cat", "hype"] },
	{ id: "big-hug", label: "Sending a big hug", url: "https://media.giphy.com/media/jXSMCVV0kSHr4bqxZM/200w.gif", tags: ["cute", "love", "cozy", "hug", "comfort"] },
	{ id: "squirrel-woohoo", label: "Squirrel woohoo", url: "https://media.giphy.com/media/fl4MZmeXzPfrYh4FeR/200w.gif", tags: ["happy", "funny", "celebration", "squirrel", "hype"] },
	{ id: "kermit-panic", label: "Kermit oh no", url: "https://media.giphy.com/media/h5JpPmYQsan1QqTeUE/200w.gif", tags: ["chaotic", "funny", "panic", "nervous", "muppets"] },
	{ id: "skeleton-cheer", label: "Skeleton crew cheering", url: "https://media.giphy.com/media/dHkua6h6uLZ0UhE4Ep/200w.gif", tags: ["happy", "chaotic", "funny", "celebration", "cartoon"] },
	{ id: "keyboard-cat", label: "Cat typing furiously", url: "https://media.giphy.com/media/JIX9t2j0ZTN9S/200w.gif", tags: ["cute", "funny", "chaotic", "cat", "typing", "busy"] },
	{ id: "judging-cat", label: "Cat judging silently", url: "https://media.giphy.com/media/mlvseq9yvZhba/200w.gif", tags: ["funny", "cat", "suspicious", "side eye", "judging"] },
	{ id: "unimpressed-cat", label: "Deeply unimpressed cat", url: "https://media.giphy.com/media/v6aOjy0Qo1fIA/200w.gif", tags: ["funny", "cat", "unimpressed", "grumpy", "nope"] },
	{ id: "kitty-kiss", label: "Kitten nose kiss", url: "https://media.giphy.com/media/MDJ9IbxxvDUQM/200w.gif", tags: ["cute", "love", "cozy", "cat", "kiss"] },
	{ id: "kitten-scritches", label: "Kitten scritches", url: "https://media.giphy.com/media/3oriO0OEd9QIDdllqo/200w.gif", tags: ["cute", "love", "cozy", "cat", "comfort", "pats"] },
	{ id: "math-confusion", label: "Trying to do the math", url: "https://media.giphy.com/media/WRQBXSCnEFJIuxktnw/200w.gif", tags: ["funny", "confused", "thinking", "math", "huh"] },
	{ id: "sponge-panic", label: "SpongeBob and Patrick panic", url: "https://media.giphy.com/media/HUkOv6BNWc1HO/200w.gif", tags: ["chaotic", "funny", "scared", "panic", "cartoon"] },
	{ id: "raccoon-spin", label: "Cosmic spinning raccoon", url: "https://media.giphy.com/media/tHIRLHtNwxpjIFqPdV/200w.gif", tags: ["chaotic", "funny", "confused", "raccoon", "dizzy", "space"] },
	{ id: "mind-blown", label: "Mind blown into space", url: "https://media.giphy.com/media/26ufdipQqU2lhNA4g/200w.gif", tags: ["chaotic", "funny", "surprised", "mind blown", "space"] },
	{ id: "still-waiting", label: "Still waiting on the bench", url: "https://media.giphy.com/media/l0HlBO7eyXzSZkJri/200w.gif", tags: ["funny", "sad", "waiting", "bored", "patient"] },
	{ id: "confused-blink", label: "Wait, what?", url: "https://media.giphy.com/media/l41YtZOb9EUABnuqA/200w.gif", tags: ["funny", "confused", "disbelief", "huh", "blink"] },
	{ id: "friendly-wave", label: "Forrest waving hello", url: "https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/200w.gif", tags: ["happy", "funny", "hello", "wave", "greeting"] },
	{ id: "bush-retreat", label: "Homer retreating into the hedge", url: "https://media.giphy.com/media/jUwpNzg9IcyrK/200w.gif", tags: ["funny", "awkward", "lurking", "hide", "bye", "cartoon"] },
	{ id: "another-one", label: "Another one, and another one", url: "https://media.giphy.com/media/l0HlQ7LRalQqdWfao/200w.gif", tags: ["chaotic", "funny", "repeat", "again", "dj khaled"] },
	{ id: "minion-cheer", label: "Minions cheering together", url: "https://media.giphy.com/media/11sBLVxNs7v6WA/200w.gif", tags: ["happy", "chaotic", "funny", "celebration", "applause", "minions"] },
	{ id: "fancy-toast", label: "A very fancy toast", url: "https://media.giphy.com/media/g9582DNuQppxC/200w.gif", tags: ["happy", "celebration", "cheers", "toast", "approval"] },
	{ id: "excellent", label: "Excellent scheming", url: "https://media.giphy.com/media/8fen5LSZcHQ5O/200w.gif", tags: ["funny", "smug", "scheming", "excellent", "cartoon"] },
	{ id: "dramatic-tears", label: "Dramatic tears", url: "https://media.giphy.com/media/l3vR4CdLInXOhr3rO/200w.gif", tags: ["sad", "cry", "tears", "dramatic", "sobbing"] },
	{ id: "gazelle-shimmy", label: "Gazelle victory shimmy", url: "https://media.giphy.com/media/Gs4NnVZI3DX79CmxMQ/200w.gif", tags: ["happy", "funny", "dance", "celebration", "zootopia"] }
];

export const CHAT_GIFS: ChatGif[] = expandedGifs;

export function getChatGif(id: unknown): ChatGif | undefined {
	return typeof id === "string"
		? CHAT_GIFS.find((gif) => gif.id === id) ?? LEGACY_CHAT_GIFS.find((gif) => gif.id === id)
		: undefined;
}

function normalizeSearch(value: string): string {
	return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export function searchChatMedia<T extends {
	id: string;
	label: string;
	tags?: readonly string[];
	aliases?: readonly string[];
}>(items: readonly T[], query: string, category?: string): T[] {
	const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
	const tag = normalizeSearch(category ?? "");
	return items.filter((item) => {
		if (tag && tag !== "all" && tag !== "recent" && !item.tags?.some((value) => normalizeSearch(value) === tag)) {
			return false;
		}
		const fields = [item.id, item.label, ...item.aliases ?? [], ...item.tags ?? []].map(normalizeSearch);
		return tokens.every((token) => fields.some((field) => field.includes(token)));
	});
}

export const CHAT_EMOJI = [
	"😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "🙂", "🙃", "😉",
	"😍", "🥰", "😘", "😋", "😎", "🤩", "🥳", "🥹", "🥺", "🤗", "🤔", "😴",
	"😭", "😮", "😲", "😌", "🤭", "🫶", "👋", "👍", "👏", "🙌", "🤝", "✌️",
	"❤️", "🧡", "💛", "💚", "💙", "💜", "🩷", "🤍", "💕", "💖", "💗", "💞",
	"🐱", "🐶", "🐰", "🐻", "🐼", "🦊", "🐸", "🐹", "🐨", "🐥", "🦋", "🐝",
	"🌸", "🌷", "🌻", "🍀", "🌈", "⭐", "✨", "☀️", "🌙", "🎉", "🎊", "🎶",
	"🎵", "🎬", "🍿", "🍓", "🍒", "🍑", "🍪", "🍩", "🧁", "🍰", "☕", "🧋",
	"🐛", "🐞"
];
