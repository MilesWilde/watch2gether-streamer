import { useState, type SyntheticEvent } from "react";
import type { ClientMessage } from "../../stream/messages";
import type { UserRole } from "../../stream/playlist";
import type { YouTubePlaylistPreview } from "../../stream/youtube-playlists";
import { fetchPlaylistPreview } from "../lib/youtubePlaylistPreview";
import { PlaylistImportModal } from "./PlaylistImportModal";

type RequestVideoPanelProps = {
	mode: UserRole;
	password: string;
	onSend: (message: ClientMessage) => void;
	onStatusChange: (status: string | null) => void;
};

export function RequestVideoPanel({
	mode,
	password,
	onSend,
	onStatusChange
}: RequestVideoPanelProps) {
	const [url, setUrl] = useState("");
	const [playlistPreview, setPlaylistPreview] =
		useState<YouTubePlaylistPreview | null>(null);
	const [loadingPlaylist, setLoadingPlaylist] = useState(false);

	async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
		event.preventDefault();

		const trimmedUrl = url.trim();

		if (!trimmedUrl) {
			return;
		}

		if (looksLikePlaylistUrl(trimmedUrl)) {
			setLoadingPlaylist(true);
			onStatusChange(null);

			try {
				const preview = await fetchPlaylistPreview({
					url: trimmedUrl,
					mode,
					password
				});

				setPlaylistPreview(preview);
			} catch (error) {
				onStatusChange(error instanceof Error ? error.message : "Could not load playlist.");
			} finally {
				setLoadingPlaylist(false);
			}

			return;
		}

		onSend({
			type: "request_video",
			url: trimmedUrl
		});
		setUrl("");
	}

	return (
		<section className="card">
			<h2>Request video</h2>

			<form className="add-form" onSubmit={submit}>
				<label htmlFor="videoUrl">YouTube URL</label>
				<div className="input-row">
					<input
						id="videoUrl"
						name="videoUrl"
						type="url"
						placeholder="https://www.youtube.com/watch?v=..."
						value={url}
						onChange={(event) => setUrl(event.currentTarget.value)}
					/>
					<button type="submit">Request</button>
				</div>
			</form>

			{loadingPlaylist ? (
				<p className="panel-status">Loading playlist...</p>
			) : null}

			{playlistPreview ? (
				<PlaylistImportModal
					preview={playlistPreview}
					onClose={() => setPlaylistPreview(null)}
					onImport={(videos) => {
						onSend({
							type: "request_videos",
							videos
						});
						setPlaylistPreview(null);
						setUrl("");
					}}
				/>
			) : null}
		</section>
	);
}

function looksLikePlaylistUrl(url: string): boolean {
	return /(?:[?&]list=|^PL|^OLAK5uy_|^UU|^LL|^FL)/.test(url);
}
