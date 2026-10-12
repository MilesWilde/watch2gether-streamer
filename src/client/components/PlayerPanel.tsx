import type { ClientMessage } from "../../stream/messages";
import type { StreamState, UserRole } from "../../stream/playlist";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { Maximize, Minimize, Pause, Play, SkipForward, Trash2, Volume2 } from 'lucide-react';

const playbackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

type PlayerPanelProps = {
	role: UserRole;
	state: StreamState | null;
	onSend: (message: ClientMessage) => void;
	onStatusChange: (status: string | null) => void;
};

export function PlayerPanel({
	role,
	state,
	onSend,
	onStatusChange
}: PlayerPanelProps) {
	const currentItem = state?.playlist[state.currentIndex] ?? null;
	const isAdmin = role === "admin";
	const player = useYouTubePlayer({
		role,
		state,
		onSend,
		onStatusChange
	});

	function clearRoom(): void {
		const confirmed = window.confirm(
			"Clear the current video, playlist, and pending requests?"
		);

		if (confirmed) {
			onSend({ type: "clear_room" });
		}
	}

	return (
		<section className="player-panel" aria-label="Video player">
			{currentItem ? null : <div className="player-placeholder">No video selected</div>}

			<div
				ref={player.playerFrameRef}
				className={currentItem ? "youtube-player" : "youtube-player hidden"}
			>
				<div ref={player.playerMountRef} className="youtube-player-mount" />
			</div>

			<div className="transport">
				{isAdmin ? (
					<>
						<button type="button" className="icon-button" title="Play" aria-label="Play" disabled={!currentItem} onClick={player.play}>
							<Play size={18} />
						</button>
						<button type="button" className="icon-button secondary-button" title="Pause" aria-label="Pause" disabled={!currentItem} onClick={player.pause}>
							<Pause size={18} />
						</button>
						<button type="button" className="icon-button secondary-button" title="Next video" aria-label="Next video" onClick={() => onSend({ type: "next_video" })}>
							<SkipForward size={18} />
						</button>
						<button type="button" className="icon-button danger-button" title="Clear room" aria-label="Clear room" onClick={clearRoom}>
							<Trash2 size={18} />
						</button>
						<label className="speed-control" htmlFor="playbackRate">
							Speed
							<select
								id="playbackRate"
								value={state?.playback.playbackRate ?? 1}
								disabled={!currentItem}
								onChange={(event) =>
									player.setPlaybackRate(Number(event.currentTarget.value))
								}
							>
								{playbackRates.map((playbackRate) => (
									<option key={playbackRate} value={playbackRate}>
										{playbackRate}x
									</option>
								))}
							</select>
						</label>
					</>
				) : null}

				<label className="volume-control" htmlFor="volumeInput">
					<Volume2 size={18} aria-hidden="true" /><span className="sr-only">Volume</span>
					<input
						id="volumeInput"
						type="range"
						min="0"
						max="100"
						value={player.volume}
						onChange={(event) => player.setVolume(Number(event.currentTarget.value))}
					/>
				</label>

				<button
					type="button"
					className="icon-button secondary-button"
					title={player.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
					aria-label={player.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
					disabled={!currentItem}
					onClick={player.toggleFullscreen}
				>
					{player.fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
				</button>
			</div>
			<div className="now-playing">
				<span>Now playing</span>
				<p title={currentItem?.title}>{currentItem?.title ?? 'No video selected'}</p>
			</div>
		</section>
	);
}
