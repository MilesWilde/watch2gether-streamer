import type { ClientMessage } from "../../stream/messages";
import type { PlaylistItem, UserRole } from "../../stream/playlist";

type PlaylistPanelProps = {
	role: UserRole;
	playlist: PlaylistItem[];
	currentIndex: number;
	onSend: (message: ClientMessage) => void;
};

export function PlaylistPanel({
	role,
	playlist,
	currentIndex,
	onSend
}: PlaylistPanelProps) {
	const isAdmin = role === "admin";

	return (
		<section className="card">
			<h2>Playlist</h2>

			<ol className="playlist">
				{playlist.length === 0 ? (
					<li className="empty-state">No videos yet.</li>
				) : (
					playlist.map((video, index) => (
						<li className="playlist-item" key={video.id}>
							<span className="playlist-title">
								{index === currentIndex ? `▶ ${video.title}` : video.title}
							</span>

							{isAdmin ? (
								<div className="playlist-actions">
									<button
										type="button"
										className="playlist-play-button"
										title="Play this video"
										onClick={() =>
											onSend({
												type: "play_playlist_item",
												playlistItemId: video.id
											})
										}
									>
										▶
									</button>
									<button
										type="button"
										className="remove-button"
										title="Remove from playlist"
										onClick={() =>
											onSend({
												type: "remove_playlist_item",
												playlistItemId: video.id
											})
										}
									>
										×
									</button>
								</div>
							) : null}
						</li>
					))
				)}
			</ol>
		</section>
	);
}
