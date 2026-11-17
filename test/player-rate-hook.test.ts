import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamState, UserRole } from "../src/stream/playlist";
import type {} from "../src/client/types/youtube";
import { useYouTubePlayer } from "../src/client/hooks/useYouTubePlayer";
import { resetServerClock, sampleServerClock } from '../src/client/lib/serverClock';

// Exercise the hook's iframe callbacks without requiring a browser DOM renderer.
const hooks = vi.hoisted(() => ({
	slots: [] as { current?: unknown; value?: unknown; deps?: readonly unknown[]; cleanup?: void | (() => void) }[],
	index: 0,
	effects: [] as (() => void)[]
}));

function flushEffects(): void {
	for (const effect of hooks.effects.splice(0)) effect();
}

function unmount(): void {
	for (const slot of hooks.slots) {
		slot.cleanup?.();
		slot.cleanup = undefined;
	}
}

vi.mock("react", () => {
	function memo(factory: () => unknown, deps: readonly unknown[]): unknown {
		const index = hooks.index++;
		const slot = hooks.slots[index] ??= {};
		if (!slot.deps || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
			slot.value = factory();
			slot.deps = deps;
		}
		return slot.value;
	}
	return {
		useRef: (value: unknown) => {
			const index = hooks.index++;
			return hooks.slots[index] ??= { current: value };
		},
		useState: (value: unknown) => {
			const index = hooks.index++;
			const slot = hooks.slots[index] ??= { value: typeof value === "function" ? value() : value };
			return [slot.value, (nextValue: unknown) => { slot.value = nextValue; }];
		},
		useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
		useMemo: memo,
		useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
			const index = hooks.index++;
			const slot = hooks.slots[index] ??= {};
			if (!slot.deps || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
				slot.deps = deps;
				hooks.effects.push(() => {
					slot.cleanup?.();
					slot.cleanup = effect();
				});
			}
		}
	};
});

describe("iframe playback rate restoration", () => {
	let events: YT.PlayerOptions["events"];
	let rate: number;
	let player: YT.Player;
	let state: StreamState;
	const onSend = vi.fn();
	let activeSend = onSend;
	let connected: boolean;
	let constructions: number;
	let playerOptions: YT.PlayerOptions;
	const states = { PLAYING: 1, PAUSED: 2, ENDED: 0, CUED: 5, BUFFERING: 3 };

	function render(role: UserRole, commit = true): ReturnType<typeof useYouTubePlayer> {
		hooks.index = 0;
		const result = useYouTubePlayer({ role, state, connected, onSend: activeSend, onStatusChange: vi.fn() });
		if (commit) flushEffects();
		return result;
	}

	function mount(role: UserRole): ReturnType<typeof useYouTubePlayer> {
		const result = render(role, false);
		result.playerMountRef.current = { replaceChildren: vi.fn() } as unknown as HTMLDivElement;
		flushEffects();
		events.onReady({ target: player });
		render(role);
		onSend.mockClear();
		vi.mocked(player.setPlaybackRate).mockClear();
		return result;
	}

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
		vi.setSystemTime(10000);
		resetServerClock();
		sampleServerClock(10000);
		hooks.slots = [];
		hooks.effects = [];
		onSend.mockReset();
		activeSend = onSend;
		connected = true;
		constructions = 0;
		rate = 1;
		state = {
			playlist: [{ id: "a", provider: "youtube", videoId: "a", originalUrl: "", title: "A" }],
			requests: [], currentIndex: 0,
			playback: { playing: false, positionSec: 0, playbackRate: 1.5, updatedAtMs: 10000 }
		};
		player = {
			setPlaybackRate: vi.fn((value: number) => { rate = value; }),
			loadVideoById: vi.fn(() => { rate = 1; }),
			cueVideoById: vi.fn(() => { rate = 1; }),
			playVideo: vi.fn(), pauseVideo: vi.fn(), stopVideo: vi.fn(),
			getCurrentTime: () => 0, getDuration: () => 600, seekTo: vi.fn(), setVolume: vi.fn(), unMute: vi.fn(),
			destroy: vi.fn()
		} as unknown as YT.Player;
		class PlayerStub {
			constructor(_element: unknown, options: YT.PlayerOptions) {
				constructions++;
				playerOptions = options;
				events = options.events;
				return player;
			}
		}
		const api = { Player: PlayerStub, PlayerState: states };
		vi.stubGlobal("YT", api);
		vi.stubGlobal("window", {
			YT: api, setInterval, clearInterval
		});
		vi.stubGlobal("document", { createElement: () => ({}), addEventListener: vi.fn(), removeEventListener: vi.fn() });
		vi.stubGlobal("localStorage", { getItem: () => null });
	});

	afterEach(() => {
		unmount();
		resetServerClock();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('uses the latest send callback inside retained iframe events', () => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount('admin');
		const latestSend = vi.fn();
		activeSend = latestSend;
		render('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).not.toHaveBeenCalled();
		expect(latestSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'next_video', playlistItemId: 'a', playbackUpdatedAtMs: 10000 }));
	});

	it('ignores offline ended events without wedging advancement after reconnection', () => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount('admin');
		connected = false;
		render('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).not.toHaveBeenCalled();
		connected = true;
		render('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'next_video', playlistItemId: 'a', playbackUpdatedAtMs: 10000 }));
	});

	it('reconciles identical playback snapshots after reconnect rather than keeping buffered local state', () => {
		mount('admin');
		connected = false;
		render('admin');
		vi.mocked(player.pauseVideo).mockClear();
		vi.mocked(player.setPlaybackRate).mockClear();
		connected = true;
		render('admin');
		expect(player.pauseVideo).toHaveBeenCalledOnce();
		expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
		expect(onSend).not.toHaveBeenCalled();
	});

	it('advances a still-playing unchanged video that ended offline without needing a second ended event', () => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 600 } };
		mount('admin');
		connected = false;
		render('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).not.toHaveBeenCalled();
		connected = true;
		render('admin');
		expect(onSend).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'next_video', playlistItemId: 'a', playbackUpdatedAtMs: 10000 }));
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
	});

	it.each(['paused', 'changed', 'new-video'])('does not apply an offline end to authoritative %s playback', change => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 600 } };
		mount('admin');
		connected = false;
		render('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		if (change === 'paused') state = { ...state, playback: { ...state.playback, playing: false } };
		else if (change === 'changed') state = { ...state, playback: { ...state.playback, updatedAtMs: 11000 } };
		else state = { ...state, playlist: [{ ...state.playlist[0], id: 'new', videoId: 'new' }] };
		connected = true;
		render('admin');
		expect(onSend).not.toHaveBeenCalled();
	});

	it('does not replay an already pending advancement when an offline end is reconciled', () => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 600 } };
		mount('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
		connected = false;
		render('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		connected = true;
		render('admin');
		expect(onSend).toHaveBeenCalledTimes(1);
	});

	it.each(["admin", "viewer"] as const)("restores CUED and PLAYING resets for %s during suppression", (role) => {
		mount(role);
		for (const data of [states.CUED, states.PLAYING, states.PLAYING]) {
			rate = 1;
			events.onStateChange({ target: player, data });
			expect(rate).toBe(1.5);
		}
		expect(player.setPlaybackRate).toHaveBeenCalledTimes(3);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("reads the latest shared desired rate instead of the creation-time state", () => {
		mount("viewer");
		state = { ...state, playback: { ...state.playback, playbackRate: 2 } };
		render("viewer");
		rate = 1;
		events.onStateChange({ target: player, data: states.CUED });
		expect(rate).toBe(2);
	});

	it.each([
		["admin", true], ["admin", false], ["viewer", true], ["viewer", false]
	] as const)("restores speed after a real next-video transition for %s playing=%s", (role, playing) => {
		mount(role);
		state = {
			...state,
			playlist: [...state.playlist, { ...state.playlist[0], id: "b", videoId: "b" }],
			currentIndex: 1,
			playback: { ...state.playback, playing, positionSec: 8, updatedAtMs: 10001 }
		};
		render(role);
		const queueMethod = playing ? player.loadVideoById : player.cueVideoById;
		expect(queueMethod).toHaveBeenCalledWith(expect.objectContaining({ videoId: "b" }));
		vi.mocked(player.seekTo).mockClear();
		vi.mocked(player.playVideo).mockClear();
		vi.mocked(player.pauseVideo).mockClear();
		vi.mocked(player.setPlaybackRate).mockClear();
		onSend.mockClear();
		// A new snapshot with identical playback must take the application dedupe path.
		state = { ...state, playback: { ...state.playback } };
		render(role);
		expect(player.setPlaybackRate).not.toHaveBeenCalled();
		for (const data of [states.CUED, states.PLAYING]) {
			rate = 1;
			events.onStateChange({ target: player, data });
			expect(rate).toBe(1.5);
		}
		events.onStateChange({ target: player, data: states.PAUSED });
		expect(player.seekTo).not.toHaveBeenCalled();
		expect(player.playVideo).not.toHaveBeenCalled();
		expect(player.pauseVideo).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
	});

	it.each([
		["a", true], ["a", false], ["b", true], ["b", false]
	] as const)("waits for replacement PLAYING before rearming queue video %s playing=%s", (videoId, playing) => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount("admin");
		events.onStateChange({ target: player, data: states.ENDED });
		state = {
			...state, playlist: [...state.playlist, { ...state.playlist[0], id: "second", videoId }],
			currentIndex: 1, playback: { ...state.playback, playing }
		};
		const queueMethod = playing ? player.loadVideoById : player.cueVideoById;
		vi.mocked(queueMethod).mockClear();
		render("admin");
		expect(queueMethod).toHaveBeenCalledTimes(1);
		// The old iframe can deliver ENDED after the replacement snapshot is applied.
		events.onStateChange({ target: player, data: states.ENDED });
		events.onStateChange({ target: player, data: states.CUED });
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
		state = { ...state, playback: { ...state.playback } };
		render("admin");
		expect(queueMethod).toHaveBeenCalledTimes(1);
		events.onStateChange({ target: player, data: states.PLAYING });
		events.onStateChange({ target: player, data: states.ENDED });
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(playing ? 2 : 1);
		expect(onSend.mock.calls.map(([message]) => message.type)).toEqual(playing ? ["next_video", "next_video"] : ["next_video"]);
	});

	it("rearms advancement and reloads a single-video loop on authoritative restart", () => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount("admin");
		for (let loop = 1; loop <= 3; loop++) {
			state = { ...state, playback: { ...state.playback, positionSec: 600 } };
			render("admin");
			events.onStateChange({ target: player, data: states.ENDED });
			events.onStateChange({ target: player, data: states.ENDED });
			expect(onSend).toHaveBeenCalledTimes(loop);
			state = { ...state, playback: { ...state.playback, positionSec: 0, updatedAtMs: 10000 + loop } };
			vi.mocked(player.loadVideoById).mockClear();
			render("admin");
			expect(player.loadVideoById).toHaveBeenCalledTimes(1);
			events.onStateChange({ target: player, data: states.ENDED });
			expect(onSend).toHaveBeenCalledTimes(loop);
			rate = 1;
			events.onStateChange({ target: player, data: states.CUED });
			expect(rate).toBe(1.5);
			events.onStateChange({ target: player, data: states.ENDED });
			expect(onSend).toHaveBeenCalledTimes(loop);
			state = { ...state, playback: { ...state.playback } };
			render("admin");
			expect(player.loadVideoById).toHaveBeenCalledTimes(1);
			events.onStateChange({ target: player, data: states.PLAYING });
		}
	});

	it("advances exactly once before a shared-state update even inside suppression", () => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount("admin");
		events.onStateChange({ target: player, data: states.ENDED });
		events.onStateChange({ target: player, data: states.PLAYING });
		events.onStateChange({ target: player, data: states.ENDED });
		state = { ...state };
		render("admin");
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ type: "next_video" }));
	});

	it("ignores obsolete ENDED after transition suppression expires while the replacement is still cued", () => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount("admin");
		events.onStateChange({ target: player, data: states.ENDED });
		state = {
			...state, playlist: [...state.playlist, { ...state.playlist[0], id: "b", videoId: "b" }],
			currentIndex: 1
		};
		render("admin");
		events.onStateChange({ target: player, data: states.CUED });
		vi.advanceTimersByTime(2000);
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ type: "next_video" }));
	});

	it("does not rearm for a rate-only update at the ended position", () => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount("admin");
		vi.spyOn(player, "getCurrentTime").mockReturnValue(40);
		events.onStateChange({ target: player, data: states.ENDED });
		state = { ...state, playback: { ...state.playback, positionSec: 40, playbackRate: 2, updatedAtMs: 10001 } };
		render("admin");
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ type: "next_video" }));
	});

	it("rearms for a same-video restart at an earlier nonzero position", () => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount("admin");
		vi.mocked(player.loadVideoById).mockClear();
		vi.spyOn(player, "getCurrentTime").mockReturnValue(40);
		events.onStateChange({ target: player, data: states.ENDED });
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 5, updatedAtMs: 10001 } };
		render("admin");
		expect(player.loadVideoById).toHaveBeenCalledTimes(1);
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
		events.onStateChange({ target: player, data: states.PLAYING });
		state = { ...state, playback: { ...state.playback, positionSec: 600, updatedAtMs: 10002 } };
		render('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(2);
		expect(onSend.mock.calls.map(([message]) => message.type)).toEqual(["next_video", "next_video"]);
	});

	it("never advances from viewer events", () => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount("viewer");
		vi.advanceTimersByTime(2000);
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).not.toHaveBeenCalled();
	});

	it('ignores a delayed natural end after the authoritative timeline is paused', () => {
		state.playback = { ...state.playback, playing: true, positionSec: 600 };
		mount('admin');
		state = { ...state, playback: { ...state.playback, playing: false, positionSec: 590, updatedAtMs: 10001 } };
		render('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		vi.advanceTimersByTime(12000);
		expect(onSend).not.toHaveBeenCalled();
	});

	it.each(['seek', 'new-track'])('ignores an obsolete end after a %s has already started', change => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 600 } };
		mount('admin');
		state = { ...state, playback: { ...state.playback, positionSec: 10, updatedAtMs: 10001 },
			...(change === 'new-track' ? { playlist: [{ ...state.playlist[0], id: 'b', videoId: 'b' }] } : {}) };
		render('admin');
		events.onStateChange({ target: player, data: states.PLAYING });
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).not.toHaveBeenCalled();
		state = { ...state, playback: { ...state.playback, positionSec: 599, updatedAtMs: 10002 } };
		render('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledExactlyOnceWith({ type: 'next_video', playlistItemId: change === 'new-track' ? 'b' : 'a', playbackUpdatedAtMs: 10002 });
	});

	it('waits for a valid duration before trusting a natural end', () => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 600 } };
		vi.spyOn(player, 'getDuration').mockReturnValue(0);
		mount('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).not.toHaveBeenCalled();
	});

	it("keeps viewer rate commands controlled by shared server state", () => {
		const result = mount("viewer");
		result.setPlaybackRate(2);
		expect(player.setPlaybackRate).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
	});

	it("never promotes iframe playback events into shared commands", () => {
		mount("admin");
		vi.advanceTimersByTime(2000);
		rate = 1;
		events.onStateChange({ target: player, data: states.PLAYING });
		expect(rate).toBe(1.5);
		events.onStateChange({ target: player, data: states.PAUSED });
		expect(onSend).not.toHaveBeenCalled();
	});

	it.each(['admin', 'viewer'] as const)('corrects a drifting %s locally without publishing its clock', role => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 100 } };
		mount(role);
		vi.mocked(player.seekTo).mockClear();
		vi.advanceTimersByTime(4000);
		expect(player.seekTo).toHaveBeenCalledWith(expect.any(Number), true);
		expect(onSend).not.toHaveBeenCalled();
	});

	it.each(['admin', 'viewer'] as const)('recreates a %s iframe whose playing clock freezes', role => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 100 } };
		mount(role);
		const obsoleteEvents = events;
		events.onStateChange({ target: player, data: states.PLAYING });
		vi.advanceTimersByTime(10000);
		render(role);
		expect(player.destroy).toHaveBeenCalledOnce();
		expect(constructions).toBe(2);
		obsoleteEvents.onReady({ target: player });
		obsoleteEvents.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).not.toHaveBeenCalled();
		events.onReady({ target: player });
		events.onStateChange({ target: player, data: states.PLAYING });
		vi.advanceTimersByTime(10000);
		render(role);
		expect(constructions).toBe(2);
		expect(onSend).not.toHaveBeenCalled();
	});

	it('does not mistake a progressing clock for a stalled iframe', () => {
		state = { ...state, playback: { ...state.playback, playing: true } };
		vi.spyOn(player, 'getCurrentTime').mockImplementation(() => (Date.now() - 10000) / 1000 * 1.5);
		mount('admin');
		events.onStateChange({ target: player, data: states.PLAYING });
		vi.advanceTimersByTime(30000);
		expect(player.destroy).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
	});

	it.each([states.CUED, states.BUFFERING, -1])('recovers a frozen desired-playing iframe in state %s after a longer grace period', playerState => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 100 } };
		mount('viewer');
		events.onStateChange({ target: player, data: playerState });
		vi.advanceTimersByTime(19000);
		expect(player.destroy).not.toHaveBeenCalled();
		vi.advanceTimersByTime(3000);
		render('viewer');
		expect(player.destroy).toHaveBeenCalledOnce();
		expect(constructions).toBe(2);
	});

	it('keeps recovery deadlines monotonic when the system clock moves backward', () => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 100 } };
		mount('admin');
		events.onStateChange({ target: player, data: states.PLAYING });
		vi.advanceTimersByTime(3000);
		vi.setSystemTime(-3600000);
		vi.advanceTimersByTime(7000);
		render('admin');
		expect(player.destroy).toHaveBeenCalledOnce();
		expect(constructions).toBe(2);
	});

	it.each(['autoplay', 'error'])('avoids automatic iframe churn for a known %s block', cause => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 100 } };
		mount('viewer');
		if (cause === 'autoplay') events.onAutoplayBlocked?.({ target: player });
		else events.onError({ target: player, data: 150 });
		vi.advanceTimersByTime(60000);
		expect(player.destroy).not.toHaveBeenCalled();
	});

	it('retries an unacknowledged end with the latest server revision after a bounded wait', () => {
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 600 } };
		mount('admin');
		events.onStateChange({ target: player, data: states.ENDED });
		state = { ...state, playback: { ...state.playback, updatedAtMs: 10001 } };
		render('admin');
		vi.advanceTimersByTime(10000);
		expect(onSend).toHaveBeenCalledTimes(2);
		expect(onSend).toHaveBeenLastCalledWith({ type: 'next_video', playlistItemId: 'a', playbackUpdatedAtMs: 10001 });
	});

	it('exposes progress and sends explicit seeks with the current server revision', () => {
		mount('admin');
		vi.spyOn(player, 'getCurrentTime').mockReturnValue(37);
		vi.advanceTimersByTime(1000);
		const result = render('admin');
		expect(result.currentTime).toBe(37);
		expect(result.duration).toBe(600);
		result.seek(125);
		expect(onSend).toHaveBeenCalledWith({ type: 'seek_video', positionSec: 125, playlistItemId: 'a', playbackUpdatedAtMs: 10000 });
		expect(playerOptions.playerVars.controls).toBe(0);
	});

	it('keeps seek controls unavailable for viewers and disconnected admins', () => {
		mount('viewer').seek(50);
		connected = false;
		render('admin').seek(50);
		expect(onSend).not.toHaveBeenCalled();
	});

	it("sends explicit admin rate commands with the current position", () => {
		const result = mount("admin");
		result.setPlaybackRate(2);
		expect(rate).toBe(2);
		expect(onSend).toHaveBeenCalledWith({ type: "set_playback_rate", positionSec: 0, playbackRate: 2 });
	});

	it("ignores delayed ready and state callbacks after cleanup", () => {
		mount("admin");
		unmount();
		events.onReady({ target: player });
		events.onStateChange({ target: player, data: states.PLAYING });
		events.onStateChange({ target: player, data: states.ENDED });
		expect(player.setPlaybackRate).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});
