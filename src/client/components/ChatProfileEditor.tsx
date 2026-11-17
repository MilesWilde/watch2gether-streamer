import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Dices, X } from 'lucide-react';
import { MAX_CHAT_NAME_LENGTH, normalizeChatName } from '../../stream/chat';
import {
	createDefaultChatProfile, parseChatProfile, AVATAR_PARTS, ROBOT_COLORS,
	PROFILE_BACKGROUNDS, NAME_COLORS, type ChatProfile,
} from '../../stream/chat-profile';
import { randomizeChatProfile } from '../lib/robotAvatar';
import { RobotAvatar } from './RobotAvatar';

type ChatProfileEditorProps = {
	name: string;
	profile: ChatProfile;
	ready: boolean;
	onSave: (name: string, profile: ChatProfile) => boolean;
	onClose: () => void;
	triggerRef?: RefObject<HTMLButtonElement | null>;
};

const partLabels = { face: 'Head', eyes: 'Eyes', mouth: 'Mouth', top: 'Antenna / top', sides: 'Sides', ears: 'Ears', whiskers: 'Whiskers', wings: 'Wings', limbs: 'Limbs' };
const partNames: Record<string, string> = {
	eva: 'EVA', robocop: 'Visor', squareAssymetric: 'Asymmetric square',
	antennaCrooked: 'Crooked antenna', glowingBulb01: 'Glowing bulb 1', glowingBulb02: 'Glowing bulb 2',
	cat: 'Cat', bug: 'Bug', foldedCat: 'Folded cat', insectAntennae: 'Insect antennae', proboscis: 'Proboscis',
};
function partLabel(value: string): string {
	if (partNames[value]) return partNames[value];
	const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/0?(\d+)$/, ' $1');
	return words[0].toUpperCase() + words.slice(1);
}

export function ChatProfileEditor(props: ChatProfileEditorProps) {
	const [name, setName] = useState(props.name);
	const [profile, setProfile] = useState(() => parseChatProfile(props.profile) ?? createDefaultChatProfile());
	const [error, setError] = useState<string | null>(null);
	const [invalidName, setInvalidName] = useState(false);
	const [preview, setPreview] = useState<Partial<ChatProfile> | null>(null);
	const [openPart, setOpenPart] = useState<keyof typeof AVATAR_PARTS | null>(null);
	const pendingFocus = useRef<string | null>(null);
	const dialogRef = useRef<HTMLElement | null>(null);
	const nameRef = useRef<HTMLInputElement | null>(null);
	const callbacks = useRef(props);
	callbacks.current = props;
	const id = useId();
	const close = () => callbacks.current.onClose();
	const displayedProfile = preview ? { ...profile, ...preview } : profile;

	function closeParts(restoreFocus = true): void {
		setOpenPart(null);
		setPreview(null);
		if (restoreFocus && openPart) document.getElementById?.(`${id}-${openPart}`)?.focus();
	}

	useEffect(() => {
		if (!openPart) return;
		document.getElementById?.(`${id}-${openPart}-${pendingFocus.current}`)?.focus();
		function outside(event: PointerEvent): void {
			if (!(event.target instanceof Element) || !event.target.closest(`[data-profile-part="${openPart}"]`)) {
				setOpenPart(null); setPreview(null);
			}
		}
		document.addEventListener('pointerdown', outside);
		return () => document.removeEventListener('pointerdown', outside);
	}, [openPart, id]);

	useEffect(() => {
		const dialog = dialogRef.current;
		const previousFocus = document.activeElement as HTMLElement | null;
		const previousOverflow = document.body.style.overflow;
		let heldFocus = false;
		document.body.style.overflow = 'hidden';
		nameRef.current?.focus();
		heldFocus = Boolean(dialog?.contains(document.activeElement));
		function focusin(): void { heldFocus = Boolean(dialog?.contains(document.activeElement)); }
		function keydown(event: KeyboardEvent): void {
			if (event.key === 'Escape') {
				event.preventDefault();
				callbacks.current.onClose();
			} else if (event.key === 'Tab' && dialog) {
				const elements = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]'))
					.filter(element => element.tabIndex >= 0);
				const first = elements[0];
				const last = elements.at(-1);
				if (!first) { event.preventDefault(); dialog.focus(); }
				else if (!dialog.contains(document.activeElement) || document.activeElement === dialog) {
					event.preventDefault(); (event.shiftKey ? last : first)?.focus();
				} else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
				else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
			}
		}
		document.addEventListener('keydown', keydown);
		document.addEventListener('focusin', focusin);
		return () => {
			const returnFocus = dialog?.contains(document.activeElement) || (document.activeElement === document.body && heldFocus);
			document.body.style.overflow = previousOverflow;
			document.removeEventListener('keydown', keydown);
			document.removeEventListener('focusin', focusin);
			if (returnFocus) {
				const trigger = callbacks.current.triggerRef?.current ?? previousFocus;
				if (trigger?.isConnected) trigger.focus();
			}
		};
	}, []);

	function save(): void {
		if (!callbacks.current.ready) return;
		const cleaned = name.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim();
		if (!cleaned) {
			setInvalidName(true); setError('Enter a display name.'); nameRef.current?.focus(); return;
		}
		if (callbacks.current.onSave(normalizeChatName(cleaned), { ...profile })) close();
		else setError('Profile could not be saved. Please try again.');
	}

	function swatches(key: 'robotColor' | 'backgroundColor' | 'nameColor', label: string, colors: readonly { value: string; label: string }[]) {
		return <fieldset className="profile-editor-palette">
			<legend>{label}</legend>
			<div className="profile-editor-swatches">
				{colors.map(color => <button key={color.value} type="button" className="profile-editor-swatch"
					aria-label={`${label}: ${color.label}`} title={color.label} aria-pressed={profile[key] === color.value}
					onPointerEnter={() => setPreview({ [key]: color.value })} onPointerLeave={() => setPreview(null)}
					onFocus={() => setPreview({ [key]: color.value })} onBlur={() => setPreview(null)}
					onClick={() => { setProfile(current => ({ ...current, [key]: color.value })); setPreview(null); setError(null); }}>
					<span className="profile-editor-color" style={{ backgroundColor: `#${color.value}` }} aria-hidden="true">
						{profile[key] === color.value && <Check size={14} style={{ color: key === 'backgroundColor' && !['f1f4f6', 'dce9e3'].includes(color.value) ? '#fff' : '#15191d' }} />}
					</span>
				</button>)}
			</div>
		</fieldset>;
	}

	return createPortal(<div className="profile-editor-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
		<section className="profile-editor" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} ref={dialogRef} tabIndex={-1}>
			<form onSubmit={event => { event.preventDefault(); save(); }}>
				<header className="profile-editor-header">
					<h2 id={`${id}-title`}>Edit profile</h2>
					<button type="button" className="profile-editor-icon" aria-label="Close profile editor" title="Close" onClick={close}><X size={18} /></button>
				</header>
				<div className="profile-editor-preview">
					<RobotAvatar profile={displayedProfile} size={88} />
					<strong style={{ color: `#${displayedProfile.nameColor}` }}>{normalizeChatName(name)}</strong>
					<button type="button" className="profile-editor-icon" aria-label="Randomize avatar" title="Randomize avatar"
						onClick={() => { setProfile(randomizeChatProfile()); setPreview(null); setError(null); }}><Dices size={20} /></button>
				</div>
				<label className="profile-editor-name" htmlFor={`${id}-name`}>Display name
					<input id={`${id}-name`} ref={nameRef} value={name} autoComplete="nickname" aria-invalid={invalidName}
						aria-describedby={error ? `${id}-error` : undefined} onChange={event => {
							setName(Array.from(event.target.value).slice(0, MAX_CHAT_NAME_LENGTH).join('')); setInvalidName(false); setError(null);
						}} />
				</label>
				<div className="profile-editor-parts">
					{(Object.keys(AVATAR_PARTS) as (keyof typeof AVATAR_PARTS)[]).map(key => <div key={key}
						className="profile-editor-part" data-profile-part={key}
						onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeParts(false); }}
						onKeyDown={event => {
							if (event.key === 'Escape' && openPart === key) {
								event.preventDefault(); event.stopPropagation(); closeParts();
							}
						}}>
						<label htmlFor={`${id}-${key}`}>{partLabels[key]}</label>
						<button type="button" id={`${id}-${key}`} className="profile-editor-part-trigger"
							aria-label={partLabels[key]} aria-haspopup="listbox" aria-expanded={openPart === key}
							aria-controls={openPart === key ? `${id}-${key}-options` : undefined}
							onClick={() => {
								if (openPart === key) closeParts();
								else { pendingFocus.current = profile[key] ?? 'none'; setPreview(null); setOpenPart(key); }
							}}
							onKeyDown={event => {
								if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
									event.preventDefault(); pendingFocus.current = profile[key] ?? 'none'; setOpenPart(key);
								}
							}}><span>{partLabel(profile[key] ?? 'none')}</span><ChevronDown size={16} /></button>
						{openPart === key && <div id={`${id}-${key}-options`} className="profile-editor-part-options"
							role="listbox" aria-label={partLabels[key]} onPointerLeave={() => setPreview(null)}
							onKeyDown={event => {
								const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
								const index = options.indexOf(document.activeElement as HTMLButtonElement);
								let next: number | undefined;
								if (event.key === 'ArrowDown') next = (index + 1) % options.length;
								else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
								else if (event.key === 'Home') next = 0;
								else if (event.key === 'End') next = options.length - 1;
								else if (event.key.length === 1 && event.key !== ' ') {
									const ordered = [...options.slice(index + 1), ...options.slice(0, index + 1)];
									const match = ordered.find(option => option.textContent?.toLowerCase().startsWith(event.key.toLowerCase()));
									if (match) next = options.indexOf(match);
								}
								if (next !== undefined) { event.preventDefault(); options[next]?.focus(); }
							}}>
							{AVATAR_PARTS[key].map(value => <button key={value} type="button" role="option" tabIndex={-1}
								id={`${id}-${key}-${value}`} data-value={value} aria-selected={(profile[key] ?? 'none') === value}
								onPointerEnter={() => setPreview({ [key]: value })} onPointerLeave={() => setPreview(null)}
								onFocus={() => setPreview({ [key]: value })} onBlur={() => setPreview(null)}
								onClick={() => {
									const next = parseChatProfile({ ...profile, [key]: value });
									if (next) { setProfile(next); setError(null); }
									closeParts();
								}}><span>{partLabel(value)}</span>{(profile[key] ?? 'none') === value && <Check size={14} />}</button>)}
						</div>}
					</div>)}
				</div>
				{swatches('robotColor', 'Robot color', ROBOT_COLORS)}
				{swatches('backgroundColor', 'Background', PROFILE_BACKGROUNDS)}
				{swatches('nameColor', 'Name color', NAME_COLORS)}
				{!props.ready && <p className="profile-editor-status" role="status">Offline</p>}
				{error && <p className="profile-editor-error" id={`${id}-error`} role="alert">{error}</p>}
				<footer className="profile-editor-footer">
					<small><a href="https://bottts.com/" target="_blank" rel="noreferrer">Bottts by Pablo Stanley</a> | <a href="/avatars/ARTWORK-CREDITS.txt" target="_blank" rel="noreferrer">Artwork credits and licenses</a></small>
					<div className="profile-editor-actions">
						<button type="button" className="profile-editor-cancel" onClick={close}>Cancel</button>
						<button type="submit" className="profile-editor-save" disabled={!props.ready}><Check size={16} /> Save</button>
					</div>
				</footer>
			</form>
		</section>
	</div>, document.fullscreenElement ?? document.webkitFullscreenElement ?? document.body);
}
