import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Bell, MessageSquare, Play, Settings, X } from 'lucide-react';
import type { WatchPreferences } from '../lib/watchPreferences';

type WatchSettingsProps = {
	preferences: WatchPreferences;
	onChange: (preferences: Partial<WatchPreferences>) => void;
	notificationsEnabled: boolean;
	onToggleNotifications: () => void;
};

const sections = [
	{ id: 'chat', label: 'Chat', Icon: MessageSquare },
	{ id: 'notifications', label: 'Notifications', Icon: Bell },
	{ id: 'playback', label: 'Playback', Icon: Play },
] as const;
type SettingsSection = typeof sections[number]['id'];

export function WatchSettings({ preferences, onChange, notificationsEnabled, onToggleNotifications }: WatchSettingsProps) {
	const [open, setOpen] = useState(false);
	const [section, setSection] = useState<SettingsSection>('chat');
	const [horizontalTabs, setHorizontalTabs] = useState(() => typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 560px)').matches ?? false));
	const triggerRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const tabsRef = useRef<Partial<Record<SettingsSection, HTMLButtonElement>>>({});
	const selectedSectionRef = useRef(section);
	const backdropPointerRef = useRef(false);
	selectedSectionRef.current = section;

	useEffect(() => {
		const media = window.matchMedia?.('(max-width: 560px)');
		if (!media) return;
		const update = () => setHorizontalTabs(media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	}, []);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!open || !dialog) return;
		if (!dialog.open) dialog.showModal();

		const scrollContainers = new Set<HTMLElement>([document.body]);
		const fullscreen = document.fullscreenElement ?? document.webkitFullscreenElement;
		if (fullscreen instanceof HTMLElement) scrollContainers.add(fullscreen);
		const savedOverflow = [...scrollContainers].map(element => ({
			element,
			axes: ['overflow-x', 'overflow-y'].map(property => ({ property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) })),
		}));
		for (const { element } of savedOverflow) element.style.setProperty('overflow', 'hidden');
		tabsRef.current[selectedSectionRef.current]?.focus();

		return () => {
			for (const { element, axes } of savedOverflow) {
				element.style.removeProperty('overflow');
				for (const { property, value, priority } of axes) {
					if (value) element.style.setProperty(property, value, priority);
				}
			}
			if (dialog.open) dialog.close();
			if (triggerRef.current?.isConnected) triggerRef.current.focus();
		};
	}, [open]);

	function close(): void {
		backdropPointerRef.current = false;
		setOpen(false);
	}

	function outsideDialog(clientX: number, clientY: number): boolean {
		const bounds = dialogRef.current?.getBoundingClientRect();
		return Boolean(bounds && (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom));
	}

	function navigateTabs(event: ReactKeyboardEvent<HTMLButtonElement>, index: number): void {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		let next: number;
		if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = sections.length - 1;
		else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + sections.length - 1) % sections.length;
		else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % sections.length;
		else return;
		event.preventDefault();
		setSection(sections[next].id);
		tabsRef.current[sections[next].id]?.focus();
	}

	function containTabFocus(event: ReactKeyboardEvent<HTMLDialogElement>): void {
		if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
		const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
			.filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
		const first = focusable[0];
		const last = focusable.at(-1);
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault(); last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault(); first?.focus();
		}
	}

	return <div className="watch-settings">
		<button ref={triggerRef} type="button" className="icon-button secondary-button" title="Viewing settings" aria-label="Viewing settings" aria-haspopup="dialog" aria-expanded={open} aria-controls="watch-settings" onClick={() => setOpen(true)}><Settings size={18} aria-hidden="true" /></button>
		<dialog ref={dialogRef} id="watch-settings" className="watch-settings-dialog" aria-labelledby="watch-settings-title" aria-modal="true" onKeyDown={containTabFocus}
			onCancel={event => { event.preventDefault(); close(); }}
			onClose={event => {
				// Strict Mode cleanup can queue a close event before the dialog reopens.
				if (event.currentTarget.open) return;
				close();
			}}
			onPointerDown={event => { backdropPointerRef.current = event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY); }}
			onPointerCancel={() => { backdropPointerRef.current = false; }}
			onClick={event => {
				if (backdropPointerRef.current && event.target === event.currentTarget && outsideDialog(event.clientX, event.clientY)) close();
				backdropPointerRef.current = false;
			}}>
			<header className="watch-settings-header"><h2 id="watch-settings-title">Viewing settings</h2><button type="button" className="icon-button secondary-button" aria-label="Close viewing settings" onClick={close}><X size={18} aria-hidden="true" /></button></header>
			<div className="watch-settings-body">
				<nav className="watch-settings-nav" role="tablist" aria-label="Settings categories" aria-orientation={horizontalTabs ? 'horizontal' : 'vertical'}>
					{sections.map(({ id, label, Icon }, index) => <button key={id} ref={element => { if (element) tabsRef.current[id] = element; else delete tabsRef.current[id]; }} type="button" role="tab" id={'watch-settings-tab-' + id} aria-selected={section === id} aria-controls="watch-settings-content" tabIndex={section === id ? 0 : -1} onClick={() => setSection(id)} onKeyDown={event => navigateTabs(event, index)}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>)}
				</nav>
				<section id="watch-settings-content" className="watch-settings-content" role="tabpanel" aria-labelledby={'watch-settings-tab-' + section} tabIndex={0}>
					{section === 'chat' && <>
						<h3>Chat</h3>
						<label className="watch-setting-position"><span>Chat position</span><select value={preferences.chatSide} onChange={event => onChange({ chatSide: event.currentTarget.value === 'left' ? 'left' : 'right' })}><option value="left">Left</option><option value="right">Right</option></select></label>
						<p className="watch-setting-help">Place the full chat panel on either side of the video. On small screens, it stays below the video.</p>
						<h4>Video overlay</h4>
						<label className="watch-setting-toggle"><span>Chat over video</span><input type="checkbox" checked={preferences.chatOverlay} onChange={event => onChange({ chatOverlay: event.currentTarget.checked })} /></label>
						<label className="watch-setting-position"><span>Overlay position</span><select value={preferences.overlaySide} disabled={!preferences.chatOverlay} onChange={event => onChange({ overlaySide: event.currentTarget.value === 'right' ? 'right' : 'left' })}><option value="left">Left</option><option value="right">Right</option></select></label>
						<label className="watch-setting-opacity" htmlFor="watch-settings-opacity"><span>Overlay text opacity <output>{preferences.overlayOpacity}%</output></span><input id="watch-settings-opacity" type="range" min="0" max="100" step="1" value={preferences.overlayOpacity} disabled={!preferences.chatOverlay} onChange={event => onChange({ overlayOpacity: Number(event.currentTarget.value) })} /></label>
						<label className="watch-setting-position watch-setting-color" htmlFor="watch-settings-background-color"><span>Overlay background color</span><input id="watch-settings-background-color" type="color" value={preferences.overlayBackgroundColor} disabled={!preferences.chatOverlay} onChange={event => onChange({ overlayBackgroundColor: event.currentTarget.value })} /></label>
						<label className="watch-setting-opacity" htmlFor="watch-settings-background-opacity"><span>Overlay background opacity <output>{preferences.overlayBackgroundOpacity}%</output></span><input id="watch-settings-background-opacity" type="range" min="0" max="100" step="1" value={preferences.overlayBackgroundOpacity} disabled={!preferences.chatOverlay} onChange={event => onChange({ overlayBackgroundOpacity: Number(event.currentTarget.value) })} /></label>
						<p className="watch-setting-help">New messages appear at the bottom of the video overlay. Messages stay visible until it fills, then the oldest are removed. The full chat panel remains available.</p>
						<p className="watch-setting-help">Chat and overlay choices are saved on this browser.</p>
					</>}
					{section === 'notifications' && <>
						<h3>Notifications</h3>
						<label className="watch-setting-toggle"><span>Chat notifications</span><input type="checkbox" checked={notificationsEnabled} onChange={onToggleNotifications} /></label>
						<p className="watch-setting-help">Show unread chat activity in the browser tab title while you are away from this tab.</p>
						<p className="watch-setting-help">This choice lasts through reconnects and resets when you rejoin a room.</p>
					</>}
					{section === 'playback' && <>
						<h3>Playback</h3>
						<label className="watch-setting-toggle"><span>Theater mode <kbd>T</kbd></span><input type="checkbox" checked={preferences.theater} onChange={event => onChange({ theater: event.currentTarget.checked })} /></label>
						<p className="watch-setting-help">Use more of the window for video while keeping chat visible.</p>
						<p className="watch-setting-help">Outside settings, press <kbd>T</kbd> when you are not typing to toggle theater mode. This choice is saved on this browser.</p>
					</>}
				</section>
			</div>
			<footer className="watch-settings-footer"><small>Changes apply immediately.</small><button type="button" onClick={close}>Done</button></footer>
		</dialog>
	</div>;
}
