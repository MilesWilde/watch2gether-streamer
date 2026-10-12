export type ChatGif = { id: string; label: string; url: string };

export const CHAT_GIFS: ChatGif[] = [
	{ id: "cat-pats", label: "Cat head pats", url: "https://media.giphy.com/media/KztT2c4u8mYYUiMKdJ/200w.gif" },
	{ id: "fox-love", label: "Fox love", url: "https://media.giphy.com/media/s6Ru4Jpl7EJkjyjq75/200w.gif" },
	{ id: "tiny-chick", label: "Tiny chick", url: "https://media.giphy.com/media/YR0IBYGICPmzehJ6um/200w.gif" },
	{ id: "kitty", label: "Little kitty", url: "https://media.giphy.com/media/3o8dFsCL0z8cgjoWzK/200w.gif" },
	{ id: "happy-wave", label: "Happy wave", url: "https://media.giphy.com/media/O0VBge9U7f8j21UqNj/200w.gif" },
	{ id: "summer-cat", label: "Summer cat", url: "https://media.giphy.com/media/TEBseeS5mJCje0NKs9/200w.gif" },
	{ id: "love-you", label: "Love you", url: "https://media.giphy.com/media/ViSpZL4Nz52k0fiowe/200w.gif" },
	{ id: "music-frog", label: "Music frog", url: "https://media.giphy.com/media/6FxJBpNTBgWdJCXKD4/200w.gif" },
	{ id: "happy-heart", label: "Happy heart", url: "https://media.giphy.com/media/D4xeiRd5Kbgds50E3r/200w.gif" },
	{ id: "dumpling", label: "Little dumpling", url: "https://media.giphy.com/media/qZy6R9ZfLr4BLthMh5/200w.gif" },
	{ id: "melody", label: "My Melody", url: "https://media.giphy.com/media/ts0Uy1zVJTvCo/200w.gif" },
	{ id: "tea-time", label: "Tea time", url: "https://media.giphy.com/media/lS7l4HG3tsAG0k8MoJ/200w.gif" }
];

export function getChatGif(id: unknown): ChatGif | undefined {
	return typeof id === "string" ? CHAT_GIFS.find((gif) => gif.id === id) : undefined;
}

export const CHAT_EMOJI = [
	"😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "🙂", "🙃", "😉",
	"😍", "🥰", "😘", "😋", "😎", "🤩", "🥳", "🥹", "🥺", "🤗", "🤔", "😴",
	"😭", "😮", "😲", "😌", "🤭", "🫶", "👋", "👍", "👏", "🙌", "🤝", "✌️",
	"❤️", "🧡", "💛", "💚", "💙", "💜", "🩷", "🤍", "💕", "💖", "💗", "💞",
	"🐱", "🐶", "🐰", "🐻", "🐼", "🦊", "🐸", "🐹", "🐨", "🐥", "🦋", "🐝",
	"🌸", "🌷", "🌻", "🍀", "🌈", "⭐", "✨", "☀️", "🌙", "🎉", "🎊", "🎶",
	"🎵", "🎬", "🍿", "🍓", "🍒", "🍑", "🍪", "🍩", "🧁", "🍰", "☕", "🧋"
];
