import { useRef, useState, type ReactNode } from 'react';
import type { ClientMessage } from "../../stream/messages";
import type { ChatMessage } from '../../stream/chat';
import type { StreamState, UserRole } from "../../stream/playlist";
import { useYouTubePlayer } from "../hooks/useYouTubePlayer";
import { useChatViewportHeight } from '../hooks/useChatViewportHeight';
import { Maximize, Minimize, PanelTop, Pause, Play, SkipForward, Trash2, Volume2 } from 'lucide-react';
import type { WatchPreferences } from '../lib/watchPreferences';
import { ChatOverlay } from './ChatOverlay';

const playbackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

type PlayerPanelProps = {
	role: UserRole;
	state: StreamState | null;
	connected?: boolean;
	onSend: (message: ClientMessage) => void;
	onStatusChange: (status: string | null) => void;
	preferences: WatchPreferences;
	onToggleTheater: () => void;
	settings: ReactNode;
	children: ReactNode;
	chatMessages?: ChatMessage[];
};

export function PlayerPanel({
	role,
	state,
	connected = true,
	onSend,
	onStatusChange,
	preferences,
	onToggleTheater,
	settings,
	children,
	chatMessages = []
}: PlayerPanelProps) {
	const currentItem = state?.playlist[state.currentIndex] ?? null;
	const isAdmin = role === "admin";
	const [seekDraft, setSeekDraft] = useState<{ itemId: string; position: number } | null>(null);
	const chatRef = useRef<HTMLDivElement>(null);
	useChatViewportHeight(chatRef);
	const player = useYouTubePlayer({
		role,
		state,
		connected,
		onSend,
		onStatusChange
	});
	const seekPosition = seekDraft?.itemId === currentItem?.id ? seekDraft?.position : player.currentTime;
	const seekAvailable = connected && Boolean(currentItem) && Number.isFinite(player.duration) && player.duration > 0;
	function commitSeek(): void {
		if (seekAvailable && seekDraft && seekDraft.itemId === currentItem?.id) player.seek(seekDraft.position);
		setSeekDraft(null);
	}

	function clearRoom(): void {
		const confirmed = window.confirm(
			"Clear the current video, playlist, and pending requests?"
		);

		if (confirmed) {
			onSend({ type: "clear_room" });
		}
	}

	return (
		<div ref={player.playerFrameRef} className="player-panel" data-chat-side={preferences.chatSide} role="region" aria-label="Video player">
			<div className="player-video">
				{currentItem ? null : <div className="player-placeholder">No video selected</div>}
				<div className={currentItem ? "youtube-player" : "youtube-player hidden"} inert={!connected}>
					<div ref={player.playerMountRef} className="youtube-player-mount" />
				</div>
				{currentItem && preferences.chatOverlay && <ChatOverlay messages={chatMessages} opacity={preferences.overlayOpacity} side={preferences.overlaySide} />}
			</div>
			<div ref={chatRef} className="player-chat">{children}</div>

			<div className="player-timeline">
				{isAdmin && <input type="range" min="0" max={seekAvailable ? player.duration : 1} step="1" value={Math.min(seekPosition ?? 0, player.duration || 1)} disabled={!seekAvailable} aria-label="Seek video" aria-valuetext={formatPlaybackTime(seekPosition ?? 0)}
					onChange={event => { if (currentItem) setSeekDraft({ itemId: currentItem.id, position: Number(event.currentTarget.value) }); }}
					onPointerUp={commitSeek} onPointerCancel={() => setSeekDraft(null)} onBlur={commitSeek}
					onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitSeek(); }} />}
				<span className="player-time" aria-label="Playback time">{formatPlaybackTime(seekPosition ?? 0)} / {formatPlaybackTime(player.duration)}</span>
			</div>

			<div className="transport">
				{isAdmin ? (
					<>
						<button type="button" className="icon-button" title="Play" aria-label="Play" disabled={!connected || !currentItem} onClick={player.play}>
							<Play size={18} />
						</button>
						<button type="button" className="icon-button secondary-button" title="Pause" aria-label="Pause" disabled={!connected || !currentItem} onClick={player.pause}>
							<Pause size={18} />
						</button>
						<button type="button" className="icon-button secondary-button" title="Next video" aria-label="Next video" disabled={!connected} onClick={() => onSend({ type: "next_video" })}>
							<SkipForward size={18} />
						</button>
						<button type="button" className="icon-button danger-button" title="Clear room" aria-label="Clear room" disabled={!connected} onClick={clearRoom}>
							<Trash2 size={18} />
						</button>
						<label className="speed-control" htmlFor="playbackRate">
							Speed
							<select
								id="playbackRate"
								value={state?.playback.playbackRate ?? 1}
								disabled={!connected || !currentItem}
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

				<button type="button" className="icon-button secondary-button" title={preferences.theater ? 'Exit theater mode (T)' : 'Theater mode (T)'} aria-label="Theater mode" aria-pressed={preferences.theater} aria-keyshortcuts="T" onClick={onToggleTheater}><PanelTop size={18} aria-hidden="true" /></button>
				{settings}

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
		</div>
	);
}

function formatPlaybackTime(seconds: number): string {
	const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
	const hours = Math.floor(total / 3600);
	const minutes = Math.floor(total / 60) % 60;
	const remainder = String(total % 60).padStart(2, '0');
	return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}
