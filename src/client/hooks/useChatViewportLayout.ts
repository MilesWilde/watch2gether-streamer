import { useLayoutEffect, type RefObject } from 'react';

/** Fill the visible window vertically while following the sidebar's reserved column. */
export function useChatViewportLayout(chatRef: RefObject<HTMLDivElement | null>, side: 'left' | 'right'): void {
	useLayoutEffect(() => {
		const frame = chatRef.current;
		const panel = frame?.querySelector<HTMLElement>('.chat-panel');
		if (!frame || !panel) return;
		const viewport = window.visualViewport;
		let pendingFrame: number | null = null;
		const measure = () => {
			const bounds = frame.getBoundingClientRect();
			frame.style.setProperty('--chat-viewport-top', `${viewport?.offsetTop ?? 0}px`);
			frame.style.setProperty('--chat-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
			frame.style.setProperty('--chat-viewport-left', `${bounds.left}px`);
			frame.style.setProperty('--chat-viewport-width', `${bounds.width}px`);
			// An unusually tall composer still needs a scrollable escape. Leave
			// normal panels unclipped so inline emoji suggestions can extend above them.
			panel.toggleAttribute('data-viewport-overflow', panel.scrollHeight > panel.clientHeight + 1);
		};
		const schedule = () => {
			if (pendingFrame !== null) return;
			pendingFrame = window.requestAnimationFrame(() => {
				pendingFrame = null;
				measure();
			});
		};
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
		// Track the reserved column and content changes that can require scrolling.
		const shell = frame.closest('.app-shell');
		for (const element of [frame, panel, shell, document.documentElement, ...panel.children]) {
			if (element) observer?.observe(element);
		}
		window.addEventListener('resize', schedule);
		window.addEventListener('scroll', schedule, true);
		viewport?.addEventListener('resize', schedule);
		viewport?.addEventListener('scroll', schedule);
		document.addEventListener('fullscreenchange', schedule);
		document.addEventListener('webkitfullscreenchange', schedule);
		measure();
		return () => {
			observer?.disconnect();
			if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
			window.removeEventListener('resize', schedule);
			window.removeEventListener('scroll', schedule, true);
			viewport?.removeEventListener('resize', schedule);
			viewport?.removeEventListener('scroll', schedule);
			document.removeEventListener('fullscreenchange', schedule);
			document.removeEventListener('webkitfullscreenchange', schedule);
			for (const dimension of ['top', 'height', 'left', 'width']) {
				frame.style.removeProperty(`--chat-viewport-${dimension}`);
			}
			panel.removeAttribute('data-viewport-overflow');
		};
	}, [chatRef, side]);
}
