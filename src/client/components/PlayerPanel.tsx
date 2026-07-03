import type { ClientMessage } from "../../stream/messages";
import type { StreamState, UserRole } from "../../stream/playlist";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";

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
				ref={player.playerContainerRef}
				className={currentItem ? "youtube-player" : "youtube-player hidden"}
			/>

			<div className="transport">
				{isAdmin ? (
					<>
						<button type="button" disabled={!currentItem} onClick={player.play}>
							Play
						</button>
						<button type="button" disabled={!currentItem} onClick={player.pause}>
							Pause
						</button>
						<button type="button" onClick={() => onSend({ type: "next_video" })}>
							Next
						</button>
						<button type="button" className="danger-button" onClick={clearRoom}>
							Clear
						</button>
					</>
				) : null}

				<label className="volume-control" htmlFor="volumeInput">
					Volume
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
					className="secondary-button"
					disabled={!currentItem}
					onClick={player.toggleFullscreen}
				>
					{player.fullscreen ? "Exit fullscreen" : "Fullscreen"}
				</button>
			</div>
		</section>
	);
}
