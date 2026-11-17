import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { RequestedVideoInput } from "../../stream/playlist";
import type { YouTubePlaylistPreview, YouTubePlaylistVideo } from "../../stream/youtube-playlists";

const playlistChunkSize = 25;

type PlaylistImportModalProps = {
	preview: YouTubePlaylistPreview;
	disabled?: boolean;
	onClose: () => void;
	onImport: (videos: RequestedVideoInput[]) => void;
};

export function PlaylistImportModal({
	preview,
	disabled = false,
	onClose,
	onImport
}: PlaylistImportModalProps) {
	const [visibleCount, setVisibleCount] = useState(
		Math.min(playlistChunkSize, preview.videos.length)
	);
	const visibleVideos = useMemo(
		() => preview.videos.slice(0, visibleCount),
		[preview.videos, visibleCount]
	);
	const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(
		() =>
			new Set(
				preview.videos
					.slice(0, playlistChunkSize)
					.map((video) => video.videoId)
			)
	);
	const allVisibleSelected = visibleVideos.every((video) =>
		selectedVideoIds.has(video.videoId)
	);
	const hasMoreVideos = visibleCount < preview.videos.length;
	const selectedVideos = useMemo(
		() =>
			visibleVideos.filter((video) => selectedVideoIds.has(video.videoId)),
		[visibleVideos, selectedVideoIds]
	);

	function toggleVideo(videoId: string): void {
		setSelectedVideoIds((current) => {
			const next = new Set(current);

			if (next.has(videoId)) {
				next.delete(videoId);
			} else {
				next.add(videoId);
			}

			return next;
		});
	}

	function toggleAll(): void {
		setSelectedVideoIds(
			allVisibleSelected
				? new Set(
						[...selectedVideoIds].filter(
							(videoId) => !visibleVideos.some((video) => video.videoId === videoId)
						)
					)
				: new Set([
						...selectedVideoIds,
						...visibleVideos.map((video) => video.videoId)
					])
		);
	}

	function showMore(): void {
		const nextVisibleVideos = preview.videos.slice(
			visibleCount,
			visibleCount + playlistChunkSize
		);

		setVisibleCount((current) =>
			Math.min(current + playlistChunkSize, preview.videos.length)
		);
		setSelectedVideoIds(
			(current) =>
				new Set([
					...current,
					...nextVisibleVideos.map((video) => video.videoId)
				])
		);
	}

	function importVideos(): void {
		if (disabled) return;

		const videosToImport =
			selectedVideos.length > 0 ? selectedVideos : visibleVideos;

		onImport(videosToImport.map(toRequestedVideoInput));
	}

	return createPortal(
		<div className="modal-backdrop" role="presentation">
			<section
				className="modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="playlistImportTitle"
			>
				<div className="modal-header">
					<div>
						<h2 id="playlistImportTitle">Import playlist</h2>
						<p className="modal-subtitle">
							Showing {visibleVideos.length} of {preview.videos.length} videos
							{preview.truncated ? " · showing first 200" : ""}
						</p>
					</div>

					<button type="button" className="secondary-button" onClick={onClose}>
						Close
					</button>
				</div>

				<div className="modal-toolbar">
					<button type="button" className="secondary-button" onClick={toggleAll}>
						{allVisibleSelected ? "Clear visible" : "Select visible"}
					</button>
					<span className="modal-selection-count">
						{selectedVideos.length === 0
							? "None selected; import will use all visible"
							: `${selectedVideos.length} selected`}
					</span>
				</div>

				<ul className="playlist-import-list">
					{visibleVideos.map((video) => (
						<li className="playlist-import-item" key={video.videoId}>
							<label>
								<input
									type="checkbox"
									checked={selectedVideoIds.has(video.videoId)}
									onChange={() => toggleVideo(video.videoId)}
								/>
								<span>{video.title}</span>
							</label>
						</li>
					))}
				</ul>

				<div className="modal-actions">
					{hasMoreVideos ? (
						<button type="button" className="secondary-button" onClick={showMore}>
							Show 25 more
						</button>
					) : (
						<span className="modal-selection-count">All previewed videos shown</span>
					)}
					<button type="button" className="secondary-button" onClick={onClose}>
						Cancel
					</button>
					<button type="button" disabled={disabled} onClick={importVideos}>
						Request videos
					</button>
				</div>
			</section>
		</div>,
		document.body
	);
}

function toRequestedVideoInput(video: YouTubePlaylistVideo): RequestedVideoInput {
	return {
		url: video.url,
		title: video.title
	};
}
