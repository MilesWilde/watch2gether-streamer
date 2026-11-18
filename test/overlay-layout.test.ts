import { describe, expect, it } from 'vitest';
import { moveOverlayLayout, normalizeOverlayLayout, resizeOverlayLayout, resolveOverlayLayout, type OverlayLayout } from '../src/client/lib/overlayLayout';

const viewport = { width: 1000, height: 500 };
const layout: OverlayLayout = { x: 10, y: 20, width: 30, height: 40 };

describe('saved overlay geometry', () => {
	it.each([
		undefined, null, [], 'layout', {},
		{ x: 10, y: 20, width: 30 },
		{ x: '10', y: 20, width: 30, height: 40 },
		{ x: NaN, y: 20, width: 30, height: 40 },
		{ x: 10, y: Infinity, width: 30, height: 40 },
		{ x: 10, y: 20, width: Infinity, height: 40 },
		{ x: 10, y: 20, width: 30, height: -Infinity },
		{ x: 10, y: 20, width: 0, height: 40 },
		{ x: 10, y: 20, width: 30, height: -1 },
	])('rejects missing, nonnumeric or nonpositive geometry %j', value => {
		expect(normalizeOverlayLayout(value)).toBeNull();
	});

	it('clamps each dimension and then its origin inside the video', () => {
		expect(normalizeOverlayLayout({ x: -20, y: 120, width: 150, height: 25 })).toEqual({ x: 0, y: 75, width: 100, height: 25 });
		expect(normalizeOverlayLayout({ x: 90, y: -10, width: 30, height: 120 })).toEqual({ x: 70, y: 0, width: 30, height: 100 });
	});

	it('rounds saved percentages without mutating the supplied geometry', () => {
		const source = { x: 10.123456, y: 20.654321, width: 30.987654, height: 40.123456 };
		expect(normalizeOverlayLayout(source)).toEqual({ x: 10.1235, y: 20.6543, width: 30.9877, height: 40.1235 });
		expect(source).toEqual({ x: 10.123456, y: 20.654321, width: 30.987654, height: 40.123456 });
		expect(normalizeOverlayLayout({ x: 100, y: 100, width: 0.000001, height: 0.000001 })).toEqual({ x: 99.9999, y: 99.9999, width: 0.0001, height: 0.0001 });
	});
});

describe('resolved overlay geometry', () => {
	it('preserves the automatic left and right video-relative insets', () => {
		expect(resolveOverlayLayout(null, 'left', viewport)).toEqual({ x: 10, y: 10, width: 32, height: 60 });
		expect(resolveOverlayLayout(null, 'right', viewport)).toEqual({ x: 58, y: 10, width: 32, height: 60 });
		expect(resolveOverlayLayout(null, 'right', { width: 320, height: 180 })).toEqual({ x: 10, y: 10, width: 80, height: 60 });
	});

	it('retains custom relative geometry and ignores side presets', () => {
		expect(resolveOverlayLayout(layout, 'left', viewport)).toEqual(layout);
		expect(resolveOverlayLayout(layout, 'right', { width: 2000, height: 1000 })).toEqual(layout);
	});

	it('fits runtime minimum sizes without overwriting the saved values', () => {
		const saved = { x: 90, y: 95, width: 5, height: 5 };
		expect(resolveOverlayLayout(saved, 'left', viewport)).toEqual({ x: 84, y: 84, width: 16, height: 16 });
		expect(saved).toEqual({ x: 90, y: 95, width: 5, height: 5 });
		expect(resolveOverlayLayout(layout, 'right', { width: 100, height: 60 })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
	});

	it.each([
		{ width: 0, height: 0 }, { width: 0, height: 500 }, { width: 1000, height: -1 },
		{ width: NaN, height: 500 }, { width: 1000, height: Infinity },
	])('returns safe geometry before a valid viewport is available %j', bounds => {
		expect(resolveOverlayLayout(null, 'right', bounds)).toEqual({ x: 10, y: 10, width: 80, height: 60 });
		expect(resolveOverlayLayout(layout, 'left', bounds)).toEqual(layout);
		expect(moveOverlayLayout(layout, 50, 50, bounds)).toEqual(layout);
		expect(resizeOverlayLayout(layout, 50, 50, bounds)).toEqual(layout);
	});
});

describe('overlay movement', () => {
	it('converts pixel movement relative to the current video size', () => {
		expect(moveOverlayLayout(layout, 100, 50, viewport)).toEqual({ x: 20, y: 30, width: 30, height: 40 });
		expect(moveOverlayLayout(layout, 100, 50, { width: 2000, height: 1000 })).toEqual({ x: 15, y: 25, width: 30, height: 40 });
		expect(layout).toEqual({ x: 10, y: 20, width: 30, height: 40 });
	});

	it('clamps movement on every edge without changing size', () => {
		expect(moveOverlayLayout(layout, -10000, -10000, viewport)).toEqual({ x: 0, y: 0, width: 30, height: 40 });
		expect(moveOverlayLayout(layout, 10000, 10000, viewport)).toEqual({ x: 70, y: 60, width: 30, height: 40 });
		expect(moveOverlayLayout(layout, NaN, Infinity, viewport)).toEqual(layout);
	});
});

describe('overlay resizing', () => {
	it('resizes the bottom-right corner while keeping the top-left fixed', () => {
		expect(resizeOverlayLayout(layout, 100, 50, viewport)).toEqual({ x: 10, y: 20, width: 40, height: 50 });
		expect(resizeOverlayLayout(layout, 100, 50, { width: 2000, height: 1000 })).toEqual({ x: 10, y: 20, width: 35, height: 45 });
		expect(layout).toEqual({ x: 10, y: 20, width: 30, height: 40 });
	});

	it('enforces 160 by 80 pixel minima and the remaining video bounds', () => {
		expect(resizeOverlayLayout(layout, -10000, -10000, viewport)).toEqual({ x: 10, y: 20, width: 16, height: 16 });
		expect(resizeOverlayLayout(layout, 10000, 10000, viewport)).toEqual({ x: 10, y: 20, width: 90, height: 80 });
		const edge = { x: 95, y: 95, width: 5, height: 5 };
		expect(resizeOverlayLayout(edge, -10000, -10000, viewport)).toEqual(edge);
		expect(resizeOverlayLayout({ x: 0, y: 0, width: 80, height: 60 }, -100, -100, { width: 100, height: 60 })).toEqual({ x: 0, y: 0, width: 100, height: 100 });
	});

	it('ignores non-finite deltas and rounds resized geometry', () => {
		expect(resizeOverlayLayout(layout, NaN, Infinity, viewport)).toEqual(layout);
		expect(resizeOverlayLayout(layout, 1.234567, 2.345678, viewport)).toEqual({ x: 10, y: 20, width: 30.1235, height: 40.4691 });
	});
});
