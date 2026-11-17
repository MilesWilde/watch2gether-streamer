import { useEffect, useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';
import type { WatchPreferences } from '../lib/watchPreferences';

type WatchSettingsProps = {
	preferences: WatchPreferences;
	onChange: (preferences: Partial<WatchPreferences>) => void;
	notificationsEnabled: boolean;
	onToggleNotifications: () => void;
};

export function WatchSettings({ preferences, onChange, notificationsEnabled, onToggleNotifications }: WatchSettingsProps) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLElement>(null);
	const firstControlRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		const positionPanel = () => {
			const panel = panelRef.current;
			const trigger = triggerRef.current;
			if (!panel || !trigger) return;
			const anchor = trigger.getBoundingClientRect();
			const bounds = panel.getBoundingClientRect();
			const margin = 8;
			const gap = 12;
			let top = anchor.top - bounds.height - gap;
			if (top < margin && anchor.bottom + gap + bounds.height <= window.innerHeight - margin) top = anchor.bottom + gap;
			panel.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - bounds.height - margin))}px`;
			panel.style.left = `${Math.max(margin, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - margin))}px`;
			panel.style.visibility = 'visible';
		};
		positionPanel();
		window.addEventListener('resize', positionPanel);
		window.addEventListener('scroll', positionPanel, true);
		document.addEventListener('fullscreenchange', positionPanel);
		document.addEventListener('webkitfullscreenchange', positionPanel);
		return () => {
			window.removeEventListener('resize', positionPanel);
			window.removeEventListener('scroll', positionPanel, true);
			document.removeEventListener('fullscreenchange', positionPanel);
			document.removeEventListener('webkitfullscreenchange', positionPanel);
		};
	}, [open, preferences.chatOverlay, preferences.theater]);

	useEffect(() => {
		if (!open) return;
		firstControlRef.current?.focus();
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			event.stopPropagation();
			setOpen(false);
			triggerRef.current?.focus();
		};
		document.addEventListener('pointerdown', onPointerDown);
		rootRef.current?.addEventListener('keydown', onKeyDown);
		const root = rootRef.current;
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			root?.removeEventListener('keydown', onKeyDown);
		};
	}, [open]);

	return <div className="watch-settings" ref={rootRef} onBlur={event => {
		if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
	}}>
		<button ref={triggerRef} type="button" className="icon-button secondary-button" title="Viewing settings" aria-label="Viewing settings" aria-expanded={open} aria-controls="watch-settings" onClick={() => setOpen(value => !value)}><Settings size={18} aria-hidden="true" /></button>
		{open && <section ref={panelRef} id="watch-settings" className="watch-settings-panel" aria-label="Viewing settings">
			<header><h2>Viewing settings</h2><button type="button" className="icon-button secondary-button" aria-label="Close viewing settings" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}><X size={16} aria-hidden="true" /></button></header>
			<label className="watch-setting-toggle"><span>Chat over video</span><input ref={firstControlRef} type="checkbox" checked={preferences.chatOverlay} onChange={event => onChange({ chatOverlay: event.currentTarget.checked })} /></label>
			<label className="watch-setting-opacity"><span>Chat background opacity <output>{preferences.overlayOpacity}%</output></span><input type="range" min="0" max="100" step="1" value={preferences.overlayOpacity} disabled={!preferences.chatOverlay} onChange={event => onChange({ overlayOpacity: Number(event.currentTarget.value) })} /></label>
			<p className="watch-setting-help">Your view is saved on this browser. Chat stays below the video on small screens.</p>
			<label className="watch-setting-toggle"><span>Theater mode <kbd>T</kbd></span><input type="checkbox" checked={preferences.theater} onChange={event => onChange({ theater: event.currentTarget.checked })} /></label>
			<label className="watch-setting-toggle"><span>Chat notifications</span><input type="checkbox" checked={notificationsEnabled} onChange={onToggleNotifications} /></label>
		</section>}
	</div>;
}
