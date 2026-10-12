import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamState, UserRole } from "../src/stream/playlist";
import type {} from "../src/client/types/youtube";
import { useYouTubePlayer } from "../src/client/hooks/useYouTubePlayer";

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
	const states = { PLAYING: 1, PAUSED: 2, ENDED: 0, CUED: 5 };

	function render(role: UserRole, commit = true): ReturnType<typeof useYouTubePlayer> {
		hooks.index = 0;
		const result = useYouTubePlayer({ role, state, onSend, onStatusChange: vi.fn() });
		if (commit) flushEffects();
		return result;
	}

	function mount(role: UserRole): ReturnType<typeof useYouTubePlayer> {
		const result = render(role, false);
		result.playerMountRef.current = {} as HTMLDivElement;
		flushEffects();
		events.onReady({ target: player });
		render(role);
		onSend.mockClear();
		vi.mocked(player.setPlaybackRate).mockClear();
		return result;
	}

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(10000);
		hooks.slots = [];
		hooks.effects = [];
		onSend.mockReset();
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
			getCurrentTime: () => 0, seekTo: vi.fn(), setVolume: vi.fn(), unMute: vi.fn(),
			destroy: vi.fn()
		} as unknown as YT.Player;
		class PlayerStub {
			constructor(_element: unknown, options: YT.PlayerOptions) {
				events = options.events;
				return player;
			}
		}
		const api = { Player: PlayerStub, PlayerState: states };
		vi.stubGlobal("YT", api);
		vi.stubGlobal("window", {
			YT: api, setInterval, clearInterval
		});
		vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
		vi.stubGlobal("localStorage", { getItem: () => null });
	});

	afterEach(() => {
		unmount();
		vi.unstubAllGlobals();
		vi.useRealTimers();
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
		expect(onSend).toHaveBeenCalledTimes(2);
		expect(onSend.mock.calls).toEqual([[{ type: "next_video" }], [{ type: "next_video" }]]);
	});

	it("rearms advancement and recues a single-video loop on authoritative restart", () => {
		mount("admin");
		for (let loop = 1; loop <= 3; loop++) {
			events.onStateChange({ target: player, data: states.ENDED });
			events.onStateChange({ target: player, data: states.ENDED });
			expect(onSend).toHaveBeenCalledTimes(loop);
			state = { ...state, playback: { ...state.playback, updatedAtMs: 10000 + loop } };
			vi.mocked(player.cueVideoById).mockClear();
			render("admin");
			expect(player.cueVideoById).toHaveBeenCalledTimes(1);
			events.onStateChange({ target: player, data: states.ENDED });
			expect(onSend).toHaveBeenCalledTimes(loop);
			rate = 1;
			events.onStateChange({ target: player, data: states.CUED });
			expect(rate).toBe(1.5);
			events.onStateChange({ target: player, data: states.ENDED });
			expect(onSend).toHaveBeenCalledTimes(loop);
			state = { ...state, playback: { ...state.playback } };
			render("admin");
			expect(player.cueVideoById).toHaveBeenCalledTimes(1);
			events.onStateChange({ target: player, data: states.PLAYING });
		}
	});

	it("advances exactly once before a shared-state update even inside suppression", () => {
		mount("admin");
		events.onStateChange({ target: player, data: states.ENDED });
		events.onStateChange({ target: player, data: states.PLAYING });
		events.onStateChange({ target: player, data: states.ENDED });
		state = { ...state };
		render("admin");
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith({ type: "next_video" });
	});

	it("ignores obsolete ENDED after transition suppression expires while the replacement is still cued", () => {
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
		expect(onSend).toHaveBeenCalledWith({ type: "next_video" });
	});

	it("does not rearm for a rate-only update at the ended position", () => {
		mount("admin");
		vi.spyOn(player, "getCurrentTime").mockReturnValue(40);
		events.onStateChange({ target: player, data: states.ENDED });
		state = { ...state, playback: { ...state.playback, positionSec: 40, playbackRate: 2, updatedAtMs: 10001 } };
		render("admin");
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
		expect(onSend).toHaveBeenCalledWith({ type: "next_video" });
	});

	it("rearms for a same-video restart at an earlier nonzero position", () => {
		mount("admin");
		vi.spyOn(player, "getCurrentTime").mockReturnValue(40);
		events.onStateChange({ target: player, data: states.ENDED });
		state = { ...state, playback: { ...state.playback, playing: true, positionSec: 5, updatedAtMs: 10001 } };
		render("admin");
		expect(player.loadVideoById).toHaveBeenCalledTimes(1);
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(1);
		events.onStateChange({ target: player, data: states.PLAYING });
		events.onStateChange({ target: player, data: states.ENDED });
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).toHaveBeenCalledTimes(2);
		expect(onSend.mock.calls).toEqual([[{ type: "next_video" }], [{ type: "next_video" }]]);
	});

	it("never advances from viewer events", () => {
		mount("viewer");
		vi.advanceTimersByTime(2000);
		events.onStateChange({ target: player, data: states.ENDED });
		expect(onSend).not.toHaveBeenCalled();
	});

	it("keeps viewer rate commands controlled by shared server state", () => {
		const result = mount("viewer");
		result.setPlaybackRate(2);
		expect(player.setPlaybackRate).not.toHaveBeenCalled();
		expect(onSend).not.toHaveBeenCalled();
	});

	it("still sends admin playback updates after restoring speed outside suppression", () => {
		mount("admin");
		vi.advanceTimersByTime(2000);
		rate = 1;
		events.onStateChange({ target: player, data: states.PLAYING });
		expect(rate).toBe(1.5);
		expect(onSend).toHaveBeenCalledWith({ type: "play_video", positionSec: 0 });
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
