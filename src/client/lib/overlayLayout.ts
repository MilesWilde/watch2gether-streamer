/** Geometry in percentages of the video, independent of its current pixel size. */
export type OverlayLayout = { x: number; y: number; width: number; height: number };
export type OverlayViewport = { width: number; height: number };

const fallbackLayout: Readonly<OverlayLayout> = { x: 10, y: 10, width: 80, height: 60 };
const precision = 10000;
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));
const round = (value: number): number => Math.round(value * precision) / precision;

export function normalizeOverlayLayout(value: unknown): OverlayLayout | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const layout = value as OverlayLayout;
	if (![layout.x, layout.y, layout.width, layout.height].every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate)) || layout.width <= 0 || layout.height <= 0) return null;
	// Keep a positive extent even when a small input rounds below storage precision.
	const width = Math.max(1 / precision, round(Math.min(100, layout.width)));
	const height = Math.max(1 / precision, round(Math.min(100, layout.height)));
	return {
		x: round(clamp(layout.x, 0, 100 - width)),
		y: round(clamp(layout.y, 0, 100 - height)),
		width,
		height,
	};
}

function hasViewport(viewport: OverlayViewport): boolean {
	return Number.isFinite(viewport?.width) && viewport.width > 0 && Number.isFinite(viewport?.height) && viewport.height > 0;
}

function minimumSize(viewport: OverlayViewport): { width: number; height: number } {
	return { width: Math.min(160, viewport.width) / viewport.width * 100, height: Math.min(80, viewport.height) / viewport.height * 100 };
}

function deltaPercent(pixels: number, extent: number): number {
	return Number.isFinite(pixels) ? pixels / extent * 100 : 0;
}

/** Fit a saved layout for display without replacing its stored percentages. */
export function resolveOverlayLayout(layout: OverlayLayout | null, side: 'left' | 'right', viewport: OverlayViewport): OverlayLayout {
	const saved = normalizeOverlayLayout(layout);
	if (!hasViewport(viewport)) return saved ?? { ...fallbackLayout };
	if (!saved) {
		const width = Math.min(80, 320 / viewport.width * 100);
		return normalizeOverlayLayout({ x: side === 'right' ? 90 - width : 10, y: 10, width, height: 60 })!;
	}
	const minimum = minimumSize(viewport);
	return normalizeOverlayLayout({ ...saved, width: Math.max(saved.width, minimum.width), height: Math.max(saved.height, minimum.height) })!;
}

/** Apply a gesture's pixel delta to its starting geometry, preserving its size. */
export function moveOverlayLayout(layout: OverlayLayout, dxPx: number, dyPx: number, viewport: OverlayViewport): OverlayLayout {
	const current = normalizeOverlayLayout(layout) ?? { ...fallbackLayout };
	if (!hasViewport(viewport)) return current;
	return normalizeOverlayLayout({
		...current,
		x: clamp(current.x + deltaPercent(dxPx, viewport.width), 0, 100 - current.width),
		y: clamp(current.y + deltaPercent(dyPx, viewport.height), 0, 100 - current.height),
	})!;
}

/** Resize from the bottom-right, keeping the starting top-left corner fixed. */
export function resizeOverlayLayout(layout: OverlayLayout, dxPx: number, dyPx: number, viewport: OverlayViewport): OverlayLayout {
	const current = normalizeOverlayLayout(layout) ?? { ...fallbackLayout };
	if (!hasViewport(viewport)) return current;
	const minimum = minimumSize(viewport);
	const maximumWidth = 100 - current.x;
	const maximumHeight = 100 - current.y;
	return normalizeOverlayLayout({
		...current,
		width: clamp(current.width + deltaPercent(dxPx, viewport.width), Math.min(minimum.width, maximumWidth), maximumWidth),
		height: clamp(current.height + deltaPercent(dyPx, viewport.height), Math.min(minimum.height, maximumHeight), maximumHeight),
	})!;
}
