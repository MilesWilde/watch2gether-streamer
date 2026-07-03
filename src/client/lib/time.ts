export function formatTime(timestampMs: number): string {
	if (!timestampMs) {
		return "unknown time";
	}

	return new Intl.DateTimeFormat(undefined, {
		hour: "numeric",
		minute: "2-digit"
	}).format(new Date(timestampMs));
}
