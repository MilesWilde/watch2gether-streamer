import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { moveOverlayLayout, resizeOverlayLayout, resolveOverlayLayout, type OverlayLayout } from '../lib/overlayLayout';

type Viewport = { width: number; height: number };
type Gesture = {
	pointerId: number;
	x: number;
	y: number;
	kind: 'move' | 'resize';
	layout: OverlayLayout;
	viewport: Viewport;
	target: HTMLElement;
};

function sameLayout(first: OverlayLayout, second: OverlayLayout): boolean {
	return first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;
}

export function useOverlayEditor({ frameRef, mounted, editing, layout, side, onLayoutChange, onFinishEditing }: {
	frameRef: RefObject<HTMLDivElement | null>;
	mounted: boolean;
	editing: boolean;
	layout: OverlayLayout | null;
	side: 'left' | 'right';
	onLayoutChange?: (layout: OverlayLayout | null) => void;
	onFinishEditing?: () => void;
}) {
	const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
	const [preview, setPreview] = useState<OverlayLayout | null>(null);
	const gestureRef = useRef<Gesture | null>(null);
	const moveRef = useRef<HTMLButtonElement>(null);
	const finishRef = useRef(onFinishEditing);
	finishRef.current = onFinishEditing;

	function readViewport(): Viewport {
		const bounds = frameRef.current?.parentElement?.getBoundingClientRect();
		return bounds ? { width: bounds.width, height: bounds.height } : viewport;
	}

	function releaseGesture(): Gesture | null {
		const gesture = gestureRef.current;
		gestureRef.current = null;
		if (gesture?.target.hasPointerCapture(gesture.pointerId)) gesture.target.releasePointerCapture(gesture.pointerId);
		return gesture;
	}

	function cancelGesture(): void {
		if (releaseGesture()) setPreview(null);
	}

	useLayoutEffect(() => {
		const video = frameRef.current?.parentElement;
		if (!mounted || !video) return;
		const update = () => {
			const bounds = video.getBoundingClientRect();
			setViewport(previous => {
				if (previous.width === bounds.width && previous.height === bounds.height) return previous;
				return { width: bounds.width, height: bounds.height };
			});
			if (gestureRef.current && (gestureRef.current.viewport.width !== bounds.width || gestureRef.current.viewport.height !== bounds.height)) cancelGesture();
		};
		update();
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
		observer?.observe(video);
		window.addEventListener('resize', update);
		return () => {
			observer?.disconnect();
			window.removeEventListener('resize', update);
		};
	}, [mounted]);

	useEffect(() => {
		if (!editing || typeof document === 'undefined') return;
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const cog = frameRef.current?.closest('.player-panel')?.querySelector<HTMLButtonElement>('button[aria-label="Viewing settings"]');
		const focusFrame = window.requestAnimationFrame(() => moveRef.current?.focus({ preventScroll: true }));
		const onEscape = (event: globalThis.KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			const modals = document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
			if (Array.from(modals).some(modal => modal.getClientRects().length > 0 && getComputedStyle(modal).visibility !== 'hidden')) return;
			event.preventDefault();
			event.stopPropagation();
			cancelGesture();
			finishRef.current?.();
		};
		window.addEventListener('keydown', onEscape, true);
		return () => {
			window.cancelAnimationFrame(focusFrame);
			window.removeEventListener('keydown', onEscape, true);
			releaseGesture();
			setPreview(null);
			const target = previous?.isConnected && previous.getClientRects().length ? previous : cog;
			target?.focus({ preventScroll: true });
		};
	}, [editing]);

	function begin(event: PointerEvent<HTMLElement>, kind: Gesture['kind']): void {
		if (!editing || event.button !== 0 || gestureRef.current || event.isPrimary === false) return;
		const currentViewport = readViewport();
		if (currentViewport.width <= 0 || currentViewport.height <= 0) return;
		event.preventDefault();
		event.stopPropagation();
		const start = resolveOverlayLayout(layout, side, currentViewport);
		gestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, kind, layout: start, viewport: currentViewport, target: event.currentTarget };
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		setPreview(start);
	}

	function gestureLayout(event: PointerEvent<HTMLElement>, gesture: Gesture): OverlayLayout {
		const adjust = gesture.kind === 'move' ? moveOverlayLayout : resizeOverlayLayout;
		return adjust(gesture.layout, event.clientX - gesture.x, event.clientY - gesture.y, gesture.viewport);
	}

	function update(event: PointerEvent<HTMLElement>): void {
		const gesture = gestureRef.current;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		setPreview(gestureLayout(event, gesture));
	}

	function commit(event: PointerEvent<HTMLElement>): void {
		const gesture = gestureRef.current;
		if (!gesture || gesture.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		const next = gestureLayout(event, gesture);
		releaseGesture();
		setPreview(null);
		if (!sameLayout(next, gesture.layout)) onLayoutChange?.(next);
	}

	function cancel(event: PointerEvent<HTMLElement>): void {
		if (gestureRef.current?.pointerId !== event.pointerId) return;
		cancelGesture();
	}

	function keyboard(event: KeyboardEvent<HTMLElement>, kind: Gesture['kind']): void {
		if (!editing || gestureRef.current || event.altKey || event.ctrlKey || event.metaKey) return;
		const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
		const direction = directions[event.key];
		if (!direction) return;
		event.preventDefault();
		event.stopPropagation();
		const currentViewport = readViewport();
		const start = resolveOverlayLayout(layout, side, currentViewport);
		const step = event.shiftKey ? 10 : 1;
		const next = (kind === 'move' ? moveOverlayLayout : resizeOverlayLayout)(start, direction[0] * step, direction[1] * step, currentViewport);
		if (!sameLayout(start, next)) onLayoutChange?.(next);
	}

	const resolved = resolveOverlayLayout(preview ?? layout, side, viewport);
	const style: CSSProperties | undefined = editing || layout ? {
		left: `${resolved.x}%`, top: `${resolved.y}%`, width: `${resolved.width}%`, height: `${resolved.height}%`, right: 'auto', bottom: 'auto',
	} : undefined;

	return {
		style,
		geometryKey: style ? `${viewport.width}:${viewport.height}:${resolved.x}:${resolved.y}:${resolved.width}:${resolved.height}` : '',
		geometryIsCurrent: () => {
			if (!style) return true;
			const bounds = frameRef.current?.parentElement?.getBoundingClientRect();
			return Boolean(bounds && viewport.width > 0 && viewport.height > 0 && Math.abs(bounds.width - viewport.width) < 0.01 && Math.abs(bounds.height - viewport.height) < 0.01);
		},
		moveRef,
		dragging: gestureRef.current?.kind,
		begin, update, commit, cancel, keyboard,
		reset: () => { cancelGesture(); onLayoutChange?.(null); },
		finish: () => { cancelGesture(); onFinishEditing?.(); },
	};
}
