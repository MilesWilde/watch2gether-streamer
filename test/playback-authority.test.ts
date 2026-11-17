import { describe, expect, it } from 'vitest';
import { getPlaybackPosition, updatePlayback } from '../src/stream/playback';

describe('server playback authority', () => {
	const playback = { playing: true, positionSec: 2260, playbackRate: 1.5, updatedAtMs: 10000 };
	it('advances from the server anchor at the selected rate', () => {
		expect(getPlaybackPosition(playback, 14000)).toBe(2266);
	});
	it('pauses at server time rather than a frozen client sample', () => {
		expect(updatePlayback(playback, { playing: false }, 14000)).toEqual({
			playing: false, positionSec: 2266, playbackRate: 1.5, updatedAtMs: 14000,
		});
	});
	it('changes speed without losing elapsed time at the previous speed', () => {
		expect(updatePlayback(playback, { playbackRate: 2 }, 14000)).toEqual({
			playing: true, positionSec: 2266, playbackRate: 2, updatedAtMs: 14000,
		});
	});
	it('only an explicit seek replaces the server position', () => {
		expect(updatePlayback(playback, { positionSec: 20 }, 14000).positionSec).toBe(20);
	});
	it('keeps revision timestamps strictly increasing for simultaneous commands', () => {
		expect(updatePlayback(playback, { positionSec: 20 }, 10000).updatedAtMs).toBe(10001);
	});
	it('does not advance paused playback or extrapolate backwards', () => {
		expect(getPlaybackPosition({ ...playback, playing: false }, 14000)).toBe(2260);
		expect(getPlaybackPosition(playback, 9000)).toBe(2260);
	});
});
