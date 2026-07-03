const storageKey = "watchparty-volume";

export function getSavedVolume(): number {
	const savedVolume = Number(localStorage.getItem(storageKey));
	return normalizeVolume(Number.isFinite(savedVolume) ? savedVolume : 80);
}

export function saveVolume(volume: number): void {
	localStorage.setItem(storageKey, String(normalizeVolume(volume)));
}

export function normalizeVolume(volume: number): number {
	if (!Number.isFinite(volume)) {
		return 80;
	}

	return Math.min(100, Math.max(0, Math.round(volume)));
}
