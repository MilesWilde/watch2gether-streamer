import { LogOut, Radio, Users } from 'lucide-react';

type RoomHeaderProps = {
	status: string;
	listenerCount: number;
	onLeave?: () => void;
};

export function RoomHeader({ status, listenerCount, onLeave }: RoomHeaderProps) {
	return (
		<header className="app-header">
			<div className="brand">
				<Radio size={24} aria-hidden="true" />
				<h1>Watch Party</h1>
			</div>

			<div className="header-actions">
				<div className="room-badge">
					<span className="connection-status" role="status">{status}</span>
					<span className="listener-count"><Users size={16} aria-hidden="true" />{listenerCount} listeners</span>
				</div>
				{onLeave && (
					<button type="button" className="secondary-button leave-button" title="Leave room" onClick={onLeave}>
						<LogOut size={16} aria-hidden="true" />Leave
					</button>
				)}
			</div>
		</header>
	);
}
