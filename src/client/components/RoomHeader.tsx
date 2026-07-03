type RoomHeaderProps = {
	status: string;
	listenerCount: number;
};

export function RoomHeader({ status, listenerCount }: RoomHeaderProps) {
	return (
		<header className="app-header">
			<div>
				<p className="eyebrow">Watch Party</p>
				<h1>Watch videos together</h1>
			</div>

			<div className="room-badge">
				<span>{status}</span>
				<span aria-hidden="true"> · </span>
				<span>{listenerCount}</span> listeners
			</div>
		</header>
	);
}
