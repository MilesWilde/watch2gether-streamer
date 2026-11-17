import type { PlaybackState } from './playlist';

export function getPlaybackPosition(playback: PlaybackState, nowMs: number): number {
	return playback.positionSec + (playback.playing
		? Math.max(0, nowMs - playback.updatedAtMs) / 1000 * playback.playbackRate
		: 0);
}

// Position changes come only from explicit seeks. Transport commands advance
// the existing server anchor instead of adopting an iframe's cached clock.
export function updatePlayback(
	playback: PlaybackState,
	change: Partial<Pick<PlaybackState, 'playing' | 'playbackRate' | 'positionSec'>>,
	nowMs: number,
): PlaybackState {
	return {
		...playback,
		positionSec: getPlaybackPosition(playback, nowMs),
		...change,
		updatedAtMs: Math.max(nowMs, playback.updatedAtMs + 1),
	};
}
