import { getChatGif } from "./chat-media";

export function isGiphyGifId(value: unknown): value is string {
	return typeof value === "string" && value === value.trim() && /^giphy:[A-Za-z0-9]{1,64}$/.test(value);
}

export function isChatGifId(value: unknown): value is string {
	return isGiphyGifId(value) || getChatGif(value) !== undefined;
}
