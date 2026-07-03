import type { ClientMessage } from "../../stream/messages";
import type { UserRole, VideoRequest } from "../../stream/playlist";
import { formatTime } from "../lib/time";

type RequestsPanelProps = {
	role: UserRole;
	requests: VideoRequest[];
	onSend: (message: ClientMessage) => void;
};

export function RequestsPanel({ role, requests, onSend }: RequestsPanelProps) {
	const isAdmin = role === "admin";

	return (
		<section className="card">
			<div className="card-header">
				<h2>Requests</h2>
				<span className="role-badge">{role}</span>
			</div>

			<ol className="playlist">
				{requests.length === 0 ? (
					<li className="empty-state">No requests yet.</li>
				) : (
					requests.map((request) => (
						<li className="request-item" key={request.id}>
							<div className="request-content">
								<div className="request-title">{request.title}</div>

								{isAdmin ? (
									<>
										<div className="request-meta">
											ID: {request.videoId} · requested {formatTime(request.requestedAtMs)}
										</div>
										<a
											className="request-link"
											href={request.originalUrl}
											target="_blank"
											rel="noreferrer"
										>
											Open
										</a>
									</>
								) : null}
							</div>

							{isAdmin ? (
								<div className="request-actions">
									<button
										type="button"
										className="approve-button"
										title="Add to playlist"
										onClick={() =>
											onSend({
												type: "approve_request",
												requestId: request.id
											})
										}
									>
										+
									</button>
									<button
										type="button"
										className="deny-button"
										title="Deny request"
										onClick={() =>
											onSend({
												type: "deny_request",
												requestId: request.id
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
