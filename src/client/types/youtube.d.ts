export {};

declare global {
	interface Window {
		YT?: typeof YT;
		onYouTubeIframeAPIReady?: () => void;
	}

	interface Document {
		webkitFullscreenElement?: Element | null;
		webkitExitFullscreen?: () => void;
	}

	interface HTMLElement {
		webkitRequestFullscreen?: () => void;
	}

	namespace YT {
		type PlayerEvent = {
			target: Player;
		};

		type OnStateChangeEvent = PlayerEvent & {
			data: number;
		};

		type OnErrorEvent = PlayerEvent & {
			data: number;
		};

		type PlayerOptions = {
			height: string;
			width: string;
			videoId: string;
			playerVars: {
				playsinline: number;
				modestbranding: number;
				controls: number;
				rel: number;
			};
			events: {
				onReady: (event: PlayerEvent) => void;
				onStateChange: (event: OnStateChangeEvent) => void;
				onError: (event: OnErrorEvent) => void;
			};
		};

		type VideoByIdOptions = {
			videoId: string;
			startSeconds: number;
		};

		class Player {
			constructor(element: string | HTMLElement, options: PlayerOptions);
			loadVideoById(options: VideoByIdOptions): void;
			cueVideoById(options: VideoByIdOptions): void;
			playVideo(): void;
			pauseVideo(): void;
			stopVideo(): void;
			seekTo(seconds: number, allowSeekAhead: boolean): void;
			getCurrentTime(): number;
			setPlaybackRate(rate: number): void;
			setVolume(volume: number): void;
			unMute(): void;
			destroy(): void;
		}

		const PlayerState: {
			PLAYING: number;
			PAUSED: number;
			ENDED: number;
		};
	}
}
