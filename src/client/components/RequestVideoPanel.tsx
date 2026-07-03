import { useState, type SyntheticEvent } from "react";
import type { ClientMessage } from "../../stream/messages";

type RequestVideoPanelProps = {
	onSend: (message: ClientMessage) => void;
};

export function RequestVideoPanel({ onSend }: RequestVideoPanelProps) {
	const [url, setUrl] = useState("");

	function submit(event: SyntheticEvent<HTMLFormElement>): void {
		event.preventDefault();

		const trimmedUrl = url.trim();

		if (!trimmedUrl) {
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
		</section>
	);
}
