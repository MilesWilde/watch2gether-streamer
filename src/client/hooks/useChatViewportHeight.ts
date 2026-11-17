import { useLayoutEffect, type RefObject } from 'react';

/** Keep the desktop composer inside the visible window as the player changes size. */
export function useChatViewportHeight(chatRef: RefObject<HTMLDivElement | null>): void {
	useLayoutEffect(() => {
		const frame = chatRef.current;
		const panel = frame?.querySelector<HTMLElement>('.chat-panel');
		if (!frame || !panel) return;
		const viewport = window.visualViewport;
		let pendingFrame: number | null = null;
		const measure = () => {
			const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
			const available = Math.max(0, bottom - frame.getBoundingClientRect().top - 12);
			frame.style.setProperty('--chat-viewport-height', `${available}px`);
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
		// Header wrapping moves chat without necessarily resizing its own frame.
		const shell = frame.closest('.app-shell');
		for (const element of [frame, panel, shell, ...panel.children]) {
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
			frame.style.removeProperty('--chat-viewport-height');
			panel.removeAttribute('data-viewport-overflow');
		};
	}, [chatRef]);
}
