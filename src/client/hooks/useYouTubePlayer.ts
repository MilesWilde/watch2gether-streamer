import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage } from "../../stream/messages";
import type { PlaybackState, StreamState, UserRole } from "../../stream/playlist";
import { getSavedVolume, normalizeVolume, saveVolume } from "../lib/volume";
import { getServerNowMs } from "../lib/serverClock";

const CORRECTION_INTERVAL_MS = 3000;
const STALLED_CLOCK_MS = 8000;
const STALLED_LOADING_MS = 20000;
const RECOVERY_COOLDOWN_MS = 30000;

type UseYouTubePlayerOptions = {
	role: UserRole;
	state: StreamState | null;
	connected?: boolean;
	onSend: (message: ClientMessage) => void;
	onStatusChange: (status: string | null) => void;
};

type UseYouTubePlayerResult = {
	playerFrameRef: RefObject<HTMLDivElement | null>;
	playerMountRef: RefObject<HTMLDivElement | null>;
	volume: number;
	fullscreen: boolean;
	currentTime: number;
	duration: number;
	seek: (positionSec: number) => void;
	setVolume: (volume: number) => void;
	setPlaybackRate: (playbackRate: number) => void;
	play: () => void;
	pause: () => void;
	toggleFullscreen: () => Promise<void>;
};

export function useYouTubePlayer({
	role,
	state,
	connected = true,
	onSend,
	onStatusChange
}: UseYouTubePlayerOptions): UseYouTubePlayerResult {
	const playerFrameRef = useRef<HTMLDivElement | null>(null);
	const playerMountRef = useRef<HTMLDivElement | null>(null);
	const playerRef = useRef<YT.Player | null>(null);
	const playerReadyRef = useRef(false);
	const latestStateRef = useRef<StreamState | null>(state);
	const roleRef = useRef<UserRole>(role);
	const connectedRef = useRef(connected);
	const onSendRef = useRef(onSend);
	const onStatusChangeRef = useRef(onStatusChange);
	const currentVideoIdRef = useRef<string | null>(null);
	const currentPlaylistItemIdRef = useRef<string | null>(null);
	const offlineEndedRef = useRef<{ itemId: string; updatedAtMs: number } | null>(null);
	const pendingAdvancementRef = useRef<{
		updatedAtMs: number;
		positionSec: number;
		replacementQueued: boolean;
		startedAtMs: number;
	} | null>(null);
	const lastAppliedPlaybackKeyRef = useRef("");
	const playbackSyncTimerRef = useRef<number | null>(null);
	const syncPlaybackRef = useRef<() => void>(() => {});
	const playerGenerationRef = useRef(0);
	const playerStateRef = useRef<number | null>(null);
	const autoplayBlockedRef = useRef(false);
	const playbackErrorRef = useRef(false);
	const clockProgressRef = useRef<{ positionSec: number; progressedAtMs: number } | null>(null);
	const lastCorrectionAtRef = useRef(-Infinity);
	const lastRecoveryAtRef = useRef(-Infinity);
	const lastCorrectionLogAtRef = useRef(-Infinity);
	const [playerGeneration, setPlayerGeneration] = useState(0);
	const [apiReady, setApiReady] = useState(Boolean(window.YT?.Player));
	const [playerReady, setPlayerReady] = useState(false);
	const [volume, setVolumeState] = useState(getSavedVolume);
	const [fullscreen, setFullscreen] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);

	latestStateRef.current = state;
	roleRef.current = role;
	connectedRef.current = connected;
	onSendRef.current = onSend;
	onStatusChangeRef.current = onStatusChange;

	const stopPlaybackSync = useCallback((): void => {
		if (playbackSyncTimerRef.current !== null) {
			window.clearInterval(playbackSyncTimerRef.current);
			playbackSyncTimerRef.current = null;
		}
	}, []);

	const getPlayerTime = useCallback((): number => {
		const currentTime = playerRef.current?.getCurrentTime?.();
		return typeof currentTime === "number" && Number.isFinite(currentTime)
			? Math.max(0, currentTime)
			: 0;
	}, []);

	const advancePlayback = useCallback((): void => {
		const latestState = latestStateRef.current;
		if (!connectedRef.current || roleRef.current !== 'admin' || !currentVideoIdRef.current || !latestState?.playback.playing || pendingAdvancementRef.current) return;
		const videoDuration = playerRef.current?.getDuration?.();
		// An old iframe ENDED event can arrive after a seek or another track starts.
		// Only the authoritative timeline reaching the current video's end can advance.
		if (typeof videoDuration !== 'number' || !Number.isFinite(videoDuration) || videoDuration <= 0 ||
			getSyncedPlaybackPosition(latestState.playback) < videoDuration - Math.min(2, videoDuration * 0.05)) return;
		pendingAdvancementRef.current = {
			updatedAtMs: latestState.playback.updatedAtMs,
			positionSec: getPlayerTime(),
			replacementQueued: false,
			startedAtMs: performance.now(),
		};
		onSendRef.current({
			type: 'next_video',
			playlistItemId: currentPlaylistItemIdRef.current!,
			playbackUpdatedAtMs: latestState.playback.updatedAtMs
		});
	}, [getPlayerTime]);

	const startPlaybackSync = useCallback((): void => {
		if (playbackSyncTimerRef.current !== null) {
			return;
		}

		playbackSyncTimerRef.current = window.setInterval(() => syncPlaybackRef.current(), 1000);
	}, []);

	const applyLocalVolume = useCallback(
		(nextVolume = volume): void => {
			const player = playerRef.current;

			if (!player?.setVolume) {
				return;
			}

			player.setVolume(nextVolume);

			if (nextVolume > 0) {
				player.unMute?.();
			}
		},
		[volume]
	);

	const applyPlaybackState = useCallback((nextState: StreamState): void => {
		const player = playerRef.current;

		if (!player || !playerReadyRef.current) {
			return;
		}

		const playback = nextState.playback;
		const playbackKey = [
			currentVideoIdRef.current,
			playback.playing ? "playing" : "paused",
			Math.round(playback.positionSec * 10),
			playback.playbackRate,
			playback.updatedAtMs
		].join(":");

		if (playbackKey === lastAppliedPlaybackKeyRef.current) {
			return;
		}

		lastAppliedPlaybackKeyRef.current = playbackKey;
		clockProgressRef.current = null;
		lastCorrectionAtRef.current = performance.now();
		player.setPlaybackRate?.(playback.playbackRate);

		if (playback.playing) {
			seekIfNeeded(player, getSyncedPlaybackPosition(playback), true);
			player.playVideo();
			return;
		}

		seekIfNeeded(player, playback.positionSec, false);
		player.pauseVideo();
	}, []);

	const renderCurrentVideo = useCallback(
		(nextState: StreamState | null): void => {
			const nextItem = nextState?.playlist[nextState.currentIndex] ?? null;
			const player = playerRef.current;

			if (!nextState || !nextItem) {
				currentVideoIdRef.current = null;
				currentPlaylistItemIdRef.current = null;
				pendingAdvancementRef.current = null;
				lastAppliedPlaybackKeyRef.current = "";
				clockProgressRef.current = null;
				setCurrentTime(0);
				setDuration(0);
				stopPlaybackSync();
				player?.stopVideo?.();
				return;
			}

			if (playerReadyRef.current) {
				startPlaybackSync();
			} else {
				stopPlaybackSync();
			}

			if (!apiReady || !player || !playerReadyRef.current) {
				return;
			}

			const pendingAdvancement = pendingAdvancementRef.current;
			// A single-item loop keeps its identity, but the server resets its playback position.
			const restartingAfterEnd = pendingAdvancement !== null && !pendingAdvancement.replacementQueued &&
				nextState.playback.updatedAtMs !== pendingAdvancement.updatedAtMs &&
				(nextState.playback.positionSec === 0 ||
					nextState.playback.positionSec < pendingAdvancement.positionSec);

			if (
				currentVideoIdRef.current !== nextItem.videoId ||
				currentPlaylistItemIdRef.current !== nextItem.id || restartingAfterEnd
			) {
				currentVideoIdRef.current = nextItem.videoId;
				currentPlaylistItemIdRef.current = nextItem.id;
				if (pendingAdvancement) {
					pendingAdvancement.replacementQueued = true;
				}
				lastAppliedPlaybackKeyRef.current = "";
				playerStateRef.current = null;
				autoplayBlockedRef.current = false;
				playbackErrorRef.current = false;
				clockProgressRef.current = null;
				setDuration(0);

				if (nextState.playback.playing) {
					player.loadVideoById({
						videoId: nextItem.videoId,
						startSeconds: getSyncedPlaybackPosition(nextState.playback)
					});
				} else {
					player.cueVideoById({
						videoId: nextItem.videoId,
						startSeconds: nextState.playback.positionSec
					});
				}

				applyPlaybackState(nextState);
				return;
			}

			applyPlaybackState(nextState);
		},
		[apiReady, applyPlaybackState, startPlaybackSync, stopPlaybackSync]
	);

	// Every iframe follows the room clock. Observed drift is never a room command.
	syncPlaybackRef.current = (): void => {
		const player = playerRef.current;
		const latestState = latestStateRef.current;
		if (!player || !playerReadyRef.current || !latestState || !currentVideoIdRef.current) return;
		const position = player.getCurrentTime?.();
		const validPosition = typeof position === 'number' && Number.isFinite(position) && position >= 0;
		const videoDuration = player.getDuration?.();
		const validDuration = typeof videoDuration === 'number' && Number.isFinite(videoDuration) && videoDuration > 0;
		if (validPosition) setCurrentTime(position);
		if (validDuration) setDuration(videoDuration);
		if (!connectedRef.current) {
			clockProgressRef.current = null;
			return;
		}

		const now = performance.now();
		const pending = pendingAdvancementRef.current;
		if (pending) {
			clockProgressRef.current = null;
			if (now - pending.startedAtMs < 10000) return;
			pendingAdvancementRef.current = null;
			logSync('advancement_timeout', { replacementQueued: pending.replacementQueued });
			if (!pending.replacementQueued && latestState.playback.playing && playerStateRef.current === YT.PlayerState.ENDED) {
				advancePlayback();
				return;
			}
		}
		const expected = Math.min(getSyncedPlaybackPosition(latestState.playback), validDuration ? videoDuration : Infinity);
		if (latestState.playback.playing && playerStateRef.current === YT.PlayerState.ENDED && validDuration &&
			expected >= videoDuration - Math.min(2, videoDuration * 0.05)) {
			advancePlayback();
			return;
		}
		const drift = validPosition ? position - expected : null;
		const progressing = latestState.playback.playing && !autoplayBlockedRef.current && !playbackErrorRef.current;
		const stallLimit = playerStateRef.current === YT.PlayerState.PLAYING ? STALLED_CLOCK_MS : STALLED_LOADING_MS;
		const previous = clockProgressRef.current;
		if (!progressing || !previous || (validPosition && Math.abs(position - previous.positionSec) > 0.1)) {
			clockProgressRef.current = { positionSec: validPosition ? position : -1, progressedAtMs: now };
		} else if (now - previous.progressedAtMs >= stallLimit && now - lastRecoveryAtRef.current >= RECOVERY_COOLDOWN_MS) {
			logSync('iframe_clock_stalled', { positionSec: validPosition ? position : null, expectedSec: expected, stalledMs: now - previous.progressedAtMs });
			lastRecoveryAtRef.current = now;
			stopPlaybackSync();
			playerReadyRef.current = false;
			playerRef.current = null;
			playerGenerationRef.current++;
			player.destroy();
			currentVideoIdRef.current = null;
			currentPlaylistItemIdRef.current = null;
			lastAppliedPlaybackKeyRef.current = '';
			clockProgressRef.current = null;
			setPlayerReady(false);
			setPlayerGeneration(playerGenerationRef.current);
			return;
		}

		if (now - lastCorrectionAtRef.current < CORRECTION_INTERVAL_MS) return;
		const wrongState = latestState.playback.playing
			? playerStateRef.current === YT.PlayerState.PAUSED || playerStateRef.current === YT.PlayerState.CUED ||
				(playerStateRef.current === YT.PlayerState.ENDED && (!validDuration || expected < videoDuration))
			: playerStateRef.current === YT.PlayerState.PLAYING;
		if (drift !== null && Math.abs(drift) < 2 && !wrongState) return;
		// Let ENDED arrive naturally at the end instead of repeatedly restarting it.
		if (latestState.playback.playing && validDuration && expected >= videoDuration && playerStateRef.current === YT.PlayerState.ENDED) return;
		lastCorrectionAtRef.current = now;
		if (drift === null || Math.abs(drift) >= 2) player.seekTo(expected, latestState.playback.playing);
		player.setPlaybackRate?.(latestState.playback.playbackRate);
		if (wrongState) {
			if (latestState.playback.playing) player.playVideo();
			else player.pauseVideo();
		}
		if (now - lastCorrectionLogAtRef.current >= RECOVERY_COOLDOWN_MS) {
			lastCorrectionLogAtRef.current = now;
			logSync('local_correction', { driftSec: drift, expectedSec: expected, playing: latestState.playback.playing });
		}
	};

	useEffect(() => {
		if (window.YT?.Player) {
			setApiReady(true);
			return;
		}

		window.onYouTubeIframeAPIReady = () => {
			setApiReady(true);
		};

		if (document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
			return;
		}

		const script = document.createElement("script");
		script.src = "https://www.youtube.com/iframe_api";
		script.async = true;
		document.head.appendChild(script);
	}, []);

	useEffect(() => {
		if (!apiReady || playerRef.current || !playerMountRef.current) {
			return;
		}

		// YouTube replaces its mount node. Keep a stable outer container for recovery.
		const mount = document.createElement('div');
		playerMountRef.current.replaceChildren(mount);
		const generation = playerGenerationRef.current;
		playerRef.current = new YT.Player(mount, {
			height: "100%",
			width: "100%",
			videoId: "",
			playerVars: {
				playsinline: 1,
				modestbranding: 1,
				controls: 0,
				rel: 0
			},
			events: {
				onReady: (event) => {
					if (generation !== playerGenerationRef.current || event.target !== playerRef.current) {
						return;
					}

					playerReadyRef.current = true;
					setPlayerReady(true);
					applyLocalVolume();
					renderCurrentVideo(latestStateRef.current);
					if (generation > 0) logSync('iframe_recovered', { attempt: generation });
				},
				onStateChange: (event) => {
					if (generation !== playerGenerationRef.current || event.target !== playerRef.current || !playerReadyRef.current) {
						return;
					}

					const latestState = latestStateRef.current;
					playerStateRef.current = event.data;
					if (event.data === YT.PlayerState.PLAYING) {
						autoplayBlockedRef.current = false;
						playbackErrorRef.current = false;
					}

					// Loading/cueing resets iframe speed even when the shared state is unchanged.
					if (
						latestState && currentVideoIdRef.current &&
						(event.data === YT.PlayerState.CUED || event.data === YT.PlayerState.PLAYING)
					) {
						event.target.setPlaybackRate?.(latestState.playback.playbackRate);
					}

					if (!connectedRef.current && roleRef.current === 'admin' && event.data === YT.PlayerState.ENDED) {
						const item = latestState?.playlist[latestState.currentIndex];
						if (item && latestState) offlineEndedRef.current = { itemId: item.id, updatedAtMs: latestState.playback.updatedAtMs };
					}
					if (!connectedRef.current || roleRef.current !== "admin") {
						return;
					}

					// Keep delayed ENDED events blocked until the replacement actually starts.
					if (event.data === YT.PlayerState.PLAYING && pendingAdvancementRef.current?.replacementQueued) {
						pendingAdvancementRef.current = null;
					}

					if (event.data === YT.PlayerState.ENDED) {
						advancePlayback();
						return;
					}

					// Shared controls are explicit app actions; iframe events are observations.
				},
				onError: (event) => {
					if (generation !== playerGenerationRef.current || event.target !== playerRef.current) return;
					playbackErrorRef.current = true;
					onStatusChangeRef.current(`YouTube error ${event.data}`);
				},
				onAutoplayBlocked: (event) => {
					if (generation !== playerGenerationRef.current || event.target !== playerRef.current) return;
					autoplayBlockedRef.current = true;
				}
			}
		});
	}, [advancePlayback, apiReady, applyLocalVolume, playerGeneration, renderCurrentVideo]);

	useEffect(() => {
		// The same server snapshot must resync an iframe that buffered during an outage.
		lastAppliedPlaybackKeyRef.current = '';
		clockProgressRef.current = null;
		if (!connected) return;
		const ended = offlineEndedRef.current;
		offlineEndedRef.current = null;
		const latestState = latestStateRef.current;
		const item = latestState?.playlist[latestState.currentIndex];
		if (ended && item?.id === ended.itemId && latestState?.playback.playing && latestState.playback.updatedAtMs === ended.updatedAtMs) advancePlayback();
		renderCurrentVideo(latestState);
	}, [advancePlayback, connected, renderCurrentVideo]);

	useEffect(() => {
		renderCurrentVideo(state);
	}, [playerReady, renderCurrentVideo, state]);

	useEffect(() => {
		applyLocalVolume(volume);
	}, [applyLocalVolume, volume]);

	useEffect(() => {
		function handleFullscreenChange(): void {
			setFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
		}

		document.addEventListener("fullscreenchange", handleFullscreenChange);
		document.addEventListener("webkitfullscreenchange", handleFullscreenChange);

		return () => {
			document.removeEventListener("fullscreenchange", handleFullscreenChange);
			document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
		};
	}, []);

	useEffect(() => {
		return () => {
			stopPlaybackSync();
			const player = playerRef.current;
			playerReadyRef.current = false;
			playerRef.current = null;
			player?.destroy?.();
		};
	}, [stopPlaybackSync]);

	return useMemo(
		() => ({
			playerFrameRef,
			playerMountRef,
			volume,
			fullscreen,
			currentTime,
			duration,
			seek: (positionSec: number) => {
				const latestState = latestStateRef.current;
				const item = latestState?.playlist[latestState.currentIndex];
				if (!connectedRef.current || roleRef.current !== 'admin' || !latestState || !item || !Number.isFinite(positionSec)) return;
				onSendRef.current({
					type: 'seek_video',
					positionSec: Math.max(0, duration > 0 ? Math.min(positionSec, duration) : positionSec),
					playlistItemId: item.id,
					playbackUpdatedAtMs: latestState.playback.updatedAtMs
				});
			},
			setVolume: (nextVolume: number) => {
				const normalizedVolume = normalizeVolume(nextVolume);
				setVolumeState(normalizedVolume);
				saveVolume(normalizedVolume);
			},
			setPlaybackRate: (playbackRate: number) => {
				if (!connectedRef.current || roleRef.current !== "admin") {
					return;
				}

				playerRef.current?.setPlaybackRate?.(playbackRate);
				onSendRef.current({
					type: "set_playback_rate",
					positionSec: getPlayerTime(),
					playbackRate
				});
			},
			play: () => {
				if (!connectedRef.current || roleRef.current !== 'admin') return;
				autoplayBlockedRef.current = false;
				playbackErrorRef.current = false;
				playerRef.current?.playVideo?.();
				onSendRef.current({ type: 'play_video', positionSec: getPlayerTime() });
			},
			pause: () => {
				if (!connectedRef.current || roleRef.current !== 'admin') return;
				playerRef.current?.pauseVideo?.();
				onSendRef.current({ type: 'pause_video', positionSec: getPlayerTime() });
			},
			toggleFullscreen: async () => {
				try {
					if (document.fullscreenElement || document.webkitFullscreenElement) {
						if (document.exitFullscreen) {
							await document.exitFullscreen();
						} else {
							document.webkitExitFullscreen?.();
						}
						return;
					}

					const element = playerFrameRef.current;

					if (element?.requestFullscreen) {
						await element.requestFullscreen();
					} else {
						element?.webkitRequestFullscreen?.();
					}
				} catch {
					onStatusChange("Fullscreen unavailable");
				}
			}
		}),
		[currentTime, duration, fullscreen, getPlayerTime, onStatusChange, volume]
	);
}

function getSyncedPlaybackPosition(playback: PlaybackState): number {
	if (!playback.playing) {
		return playback.positionSec;
	}

	const elapsedSec = Math.max(0, getServerNowMs() - playback.updatedAtMs) / 1000;
	return playback.positionSec + elapsedSec * playback.playbackRate;
}

function logSync(event: string, details: Record<string, number | boolean | null>): void {
	console.info('[watchparty:sync]', { event, ...details });
}

function seekIfNeeded(
	player: YT.Player,
	positionSec: number,
	allowSeekAhead: boolean
): void {
	const currentTime = player.getCurrentTime?.();

	if (
		typeof currentTime !== "number" ||
		!Number.isFinite(currentTime) ||
		Math.abs(currentTime - positionSec) < 1.5
	) {
		return;
	}

	player.seekTo(positionSec, allowSeekAhead);
}
