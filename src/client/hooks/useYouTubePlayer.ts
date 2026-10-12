import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage } from "../../stream/messages";
import type { PlaybackState, StreamState, UserRole } from "../../stream/playlist";
import { getSavedVolume, normalizeVolume, saveVolume } from "../lib/volume";

type UseYouTubePlayerOptions = {
	role: UserRole;
	state: StreamState | null;
	onSend: (message: ClientMessage) => void;
	onStatusChange: (status: string | null) => void;
};

type UseYouTubePlayerResult = {
	playerFrameRef: RefObject<HTMLDivElement | null>;
	playerMountRef: RefObject<HTMLDivElement | null>;
	volume: number;
	fullscreen: boolean;
	setVolume: (volume: number) => void;
	setPlaybackRate: (playbackRate: number) => void;
	play: () => void;
	pause: () => void;
	toggleFullscreen: () => Promise<void>;
};

export function useYouTubePlayer({
	role,
	state,
	onSend,
	onStatusChange
}: UseYouTubePlayerOptions): UseYouTubePlayerResult {
	const playerFrameRef = useRef<HTMLDivElement | null>(null);
	const playerMountRef = useRef<HTMLDivElement | null>(null);
	const playerRef = useRef<YT.Player | null>(null);
	const playerReadyRef = useRef(false);
	const latestStateRef = useRef<StreamState | null>(state);
	const roleRef = useRef<UserRole>(role);
	const currentVideoIdRef = useRef<string | null>(null);
	const currentPlaylistItemIdRef = useRef<string | null>(null);
	const pendingAdvancementRef = useRef<{
		updatedAtMs: number;
		positionSec: number;
		replacementQueued: boolean;
	} | null>(null);
	const lastAppliedPlaybackKeyRef = useRef("");
	const lastSentPlaybackKeyRef = useRef("");
	const suppressPlayerEventsUntilMsRef = useRef(0);
	const playbackSyncTimerRef = useRef<number | null>(null);
	const [apiReady, setApiReady] = useState(Boolean(window.YT?.Player));
	const [playerReady, setPlayerReady] = useState(false);
	const [volume, setVolumeState] = useState(getSavedVolume);
	const [fullscreen, setFullscreen] = useState(false);

	latestStateRef.current = state;
	roleRef.current = role;

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

	const sendPlaybackUpdate = useCallback(
		(playing: boolean, positionSec = getPlayerTime()): void => {
			const messageType = playing ? "play_video" : "pause_video";
			const playbackKey = [
				messageType,
				currentVideoIdRef.current,
				Math.round(positionSec * 2)
			].join(":");

			if (playbackKey === lastSentPlaybackKeyRef.current) {
				return;
			}

			lastSentPlaybackKeyRef.current = playbackKey;
			onSend({
				type: messageType,
				positionSec
			});
		},
		[getPlayerTime, onSend]
	);

	const startPlaybackSync = useCallback((): void => {
		if (playbackSyncTimerRef.current !== null) {
			return;
		}

		playbackSyncTimerRef.current = window.setInterval(() => {
			const latestState = latestStateRef.current;

			if (roleRef.current !== "admin" || !latestState?.playback || !playerReadyRef.current) {
				return;
			}

			const currentTime = getPlayerTime();
			const expectedTime = latestState.playback.playing
				? getSyncedPlaybackPosition(latestState.playback)
				: latestState.playback.positionSec;

			if (Math.abs(currentTime - expectedTime) >= 2) {
				sendPlaybackUpdate(latestState.playback.playing);
			}
		}, 1000);
	}, [getPlayerTime, sendPlaybackUpdate]);

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
		suppressPlayerEventsUntilMsRef.current = Date.now() + 1200;
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
				stopPlaybackSync();
				player?.stopVideo?.();
				return;
			}

			if (roleRef.current === "admin" && playerReadyRef.current) {
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
				lastSentPlaybackKeyRef.current = "";
				suppressPlayerEventsUntilMsRef.current = Date.now() + 1200;

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

		playerRef.current = new YT.Player(playerMountRef.current, {
			height: "100%",
			width: "100%",
			videoId: "",
			playerVars: {
				playsinline: 1,
				modestbranding: 1,
				controls: roleRef.current === "admin" ? 1 : 0,
				rel: 0
			},
			events: {
				onReady: (event) => {
					if (event.target !== playerRef.current) {
						return;
					}

					playerReadyRef.current = true;
					setPlayerReady(true);
					applyLocalVolume();
					renderCurrentVideo(latestStateRef.current);
				},
				onStateChange: (event) => {
					if (event.target !== playerRef.current || !playerReadyRef.current) {
						return;
					}

					const latestState = latestStateRef.current;

					// Loading/cueing resets iframe speed even when the shared state is unchanged.
					if (
						latestState && currentVideoIdRef.current &&
						(event.data === YT.PlayerState.CUED || event.data === YT.PlayerState.PLAYING)
					) {
						event.target.setPlaybackRate?.(latestState.playback.playbackRate);
					}

					if (roleRef.current !== "admin") {
						return;
					}

					// Keep delayed ENDED events blocked until the replacement actually starts.
					if (event.data === YT.PlayerState.PLAYING && pendingAdvancementRef.current?.replacementQueued) {
						pendingAdvancementRef.current = null;
					}

					if (event.data === YT.PlayerState.ENDED) {
						if (currentVideoIdRef.current && latestState && !pendingAdvancementRef.current) {
							pendingAdvancementRef.current = {
								updatedAtMs: latestState.playback.updatedAtMs,
								positionSec: getPlayerTime(),
								replacementQueued: false
							};
							onSend({ type: "next_video" });
						}
						return;
					}

					if (Date.now() < suppressPlayerEventsUntilMsRef.current) {
						return;
					}

					if (event.data === YT.PlayerState.PLAYING) {
						sendPlaybackUpdate(true);
						return;
					}

					if (event.data === YT.PlayerState.PAUSED) {
						sendPlaybackUpdate(false);
						return;
					}
				},
				onError: (event) => {
					onStatusChange(`YouTube error ${event.data}`);
				}
			}
		});
	}, [apiReady, applyLocalVolume, getPlayerTime, onSend, onStatusChange, renderCurrentVideo, sendPlaybackUpdate]);

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
			setVolume: (nextVolume: number) => {
				const normalizedVolume = normalizeVolume(nextVolume);
				setVolumeState(normalizedVolume);
				saveVolume(normalizedVolume);
			},
			setPlaybackRate: (playbackRate: number) => {
				if (roleRef.current !== "admin") {
					return;
				}

				playerRef.current?.setPlaybackRate?.(playbackRate);
				onSend({
					type: "set_playback_rate",
					positionSec: getPlayerTime(),
					playbackRate
				});
			},
			play: () => {
				playerRef.current?.playVideo?.();
				sendPlaybackUpdate(true, getPlayerTime());
			},
			pause: () => {
				playerRef.current?.pauseVideo?.();
				sendPlaybackUpdate(false, getPlayerTime());
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
		[fullscreen, getPlayerTime, onStatusChange, sendPlaybackUpdate, volume]
	);
}

function getSyncedPlaybackPosition(playback: PlaybackState): number {
	if (!playback.playing) {
		return playback.positionSec;
	}

	const elapsedSec = Math.max(0, Date.now() - playback.updatedAtMs) / 1000;
	return playback.positionSec + elapsedSec * playback.playbackRate;
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
