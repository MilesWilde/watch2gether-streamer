let anchor: { serverMs: number; monotonicMs: number } | null = null;
let bestRoundTripMs = Infinity;

export function resetServerClock(): void {
	anchor = null;
	bestRoundTripMs = Infinity;
}

export function sampleServerClock(serverNowMs: number, roundTripMs?: number): void {
	const latencyMs = roundTripMs ?? 0;
	if (!Number.isFinite(serverNowMs) || !Number.isFinite(latencyMs) || latencyMs < 0) return;
	if (roundTripMs !== undefined) {
		// A queued/background response is alive, but its asymmetric delay makes
		// it a poor clock sample. Retain the estimate from a faster round trip.
		if (roundTripMs > 2000 || roundTripMs > bestRoundTripMs + 100) return;
		bestRoundTripMs = Math.min(bestRoundTripMs, roundTripMs);
	}
	anchor = { serverMs: serverNowMs + latencyMs / 2, monotonicMs: performance.now() };
}

export function getServerNowMs(): number {
	return anchor ? anchor.serverMs + Math.max(0, performance.now() - anchor.monotonicMs) : Date.now();
}
