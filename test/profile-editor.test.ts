import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { ChatProfileEditor } from '../src/client/components/ChatProfileEditor';
import { RobotAvatar } from '../src/client/components/RobotAvatar';
import { createDefaultChatProfile, isChatProfile, AVATAR_PARTS } from '../src/stream/chat-profile';

const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as (() => void)[] }));
vi.mock('react', async original => ({
	...await original<typeof import('react')>(),
	useId: () => 'profile-test',
	useState: (initial: any) => {
		const slot = hooks.slots[hooks.index++] ??= { value: typeof initial === 'function' ? initial() : initial };
		return [slot.value, (value: any) => { slot.value = typeof value === 'function' ? value(slot.value) : value; }];
	},
	useRef: (value: any) => (hooks.slots[hooks.index++] ??= { current: value }),
	useEffect: (callback: () => void | (() => void), deps: unknown[]) => {
		const slot = hooks.slots[hooks.index++] ??= {};
		if (!slot.deps || deps.some((dep, i) => !Object.is(dep, slot.deps[i]))) {
			slot.deps = deps;
			hooks.effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
		}
	},
}));
vi.mock('react-dom', () => ({ createPortal: (node: ReactNode) => node }));

type Node = ReactElement<Record<string, any>>;
function nodes(node: ReactNode): Node[] {
	if (Array.isArray(node)) return node.flatMap(nodes);
	if (!node || typeof node !== 'object' || !('props' in node)) return [];
	const element = node as Node;
	return [element, ...nodes(element.props.children)];
}

describe('profile editor draft and modal lifecycle', () => {
	let props: Parameters<typeof ChatProfileEditor>[0];
	let tree: Node;
	let doc: any;
	let dialog: any;
	let nameInput: any;
	let last: any;
	let trigger: any;
	let listeners: Map<string, (event: any) => void>;
	const unmount = () => { for (const slot of hooks.slots) { slot.cleanup?.(); slot.cleanup = undefined; } };
	function render() {
		hooks.index = 0;
		tree = ChatProfileEditor(props) as unknown as Node;
		for (const node of nodes(tree)) {
			if (node.props.ref && typeof node.props.ref === 'object') {
				if (node.props.role === 'dialog') node.props.ref.current = dialog;
				else if (node.type === 'input') node.props.ref.current = nameInput;
			}
		}
		for (const effect of hooks.effects.splice(0)) effect();
		return tree;
	}
	function find(predicate: (node: Node) => boolean) {
		const result = nodes(tree).find(predicate);
		if (!result) throw Error('Missing editor element');
		return result;
	}
	const button = (label: string) => find(node => node.type === 'button' && (node.props['aria-label'] === label || node.props.children === label));
	const submit = () => find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
	const preview = () => find(node => node.type === RobotAvatar).props.profile;
	const changeName = (value: string) => { find(node => node.type === 'input').props.onChange({ target: { value } }); render(); };
	beforeEach(() => {
		hooks.slots = []; hooks.effects = []; hooks.index = 0;
		listeners = new Map();
		doc = { body: { style: { overflow: 'auto' } }, activeElement: null,
			addEventListener: (type: string, callback: any) => listeners.set(type, callback),
			removeEventListener: (type: string) => listeners.delete(type) };
		const focusable = () => ({ tabIndex: 0, isConnected: true, focus: vi.fn(function(this: any) { doc.activeElement = this; }) });
		nameInput = focusable(); last = focusable(); trigger = focusable();
		dialog = { ...focusable(), contains: (value: any) => [dialog, nameInput, last].includes(value), querySelectorAll: () => [nameInput, last] };
		doc.activeElement = trigger;
		vi.stubGlobal('document', doc);
		props = { name: 'Alex', profile: createDefaultChatProfile(), ready: true, onSave: vi.fn(() => true), onClose: vi.fn(), triggerRef: { current: trigger } };
	});
	afterEach(() => { unmount(); vi.unstubAllGlobals(); });
	it('edits a private draft, normalizes emoji names and closes only on accepted save', () => {
		render(); changeName('  A\u0301lex  😀  ');
		expect(props.onSave).not.toHaveBeenCalled();
		submit();
		expect(props.onSave).toHaveBeenCalledWith('Álex 😀', createDefaultChatProfile());
		expect(props.onClose).toHaveBeenCalledTimes(1);
	});
	it('rejects empty/control-only names and limits by code points rather than UTF-16 units', () => {
		render(); changeName(' \u0000\u202a '); submit(); render();
		expect(props.onSave).not.toHaveBeenCalled();
		expect(find(node => node.props.role === 'alert')).toBeTruthy();
		changeName('😀'.repeat(41)); submit();
		expect(props.onSave).toHaveBeenCalledWith('😀'.repeat(40), expect.any(Object));
	});
	it('keeps a rejected save draft and shows an inline error', () => {
		props.onSave = vi.fn(() => false);
		render(); changeName('New name'); submit(); render();
		expect(props.onClose).not.toHaveBeenCalled();
		expect(find(node => node.type === 'input').props.value).toBe('New name');
		expect(find(node => node.props.role === 'alert')).toBeTruthy();
	});
	it('keeps offline editing and cancel available while save is disabled', () => {
		props.ready = false; render(); changeName('Offline draft'); submit();
		expect(find(node => node.type === 'button' && node.props.type === 'submit').props.disabled).toBe(true);
		expect(props.onSave).not.toHaveBeenCalled();
		button('Cancel').props.onClick();
		expect(props.onClose).toHaveBeenCalledTimes(1);
	});
	it('offers all part choices and three labeled selected swatch groups', () => {
		render();
		const labels = { face: 'Head', eyes: 'Eyes', mouth: 'Mouth', top: 'Antenna / top', sides: 'Sides', ears: 'Ears', whiskers: 'Whiskers', wings: 'Wings', limbs: 'Limbs' };
		for (const key of Object.keys(AVATAR_PARTS) as (keyof typeof AVATAR_PARTS)[]) {
			const choices = AVATAR_PARTS[key];
			button(labels[key]).props.onClick(); render();
			const options = nodes(tree).filter(node => node.props.role === 'option');
			expect(options.map(node => node.props['data-value'])).toEqual(choices);
			options.at(-1)!.props.onClick(); render();
			expect(preview()[key] ?? 'none').toBe(choices.at(-1));
		}
		expect(nodes(tree).filter(node => node.type === 'button' && node.props['aria-pressed'] === true)).toHaveLength(3);
		submit(); expect(isChatProfile(vi.mocked(props.onSave).mock.calls[0][1])).toBe(true);
	});
	it('previews colors on hover without selecting or saving them, then restores the draft', () => {
		render(); button('Robot color: Pink').props.onPointerEnter(); render();
		expect(preview().robotColor).toBe('f5a8d2');
		expect(button('Robot color: Pink').props['aria-pressed']).toBe(false);
		submit(); expect(props.onSave).toHaveBeenCalledWith('Alex', createDefaultChatProfile());
		button('Robot color: Pink').props.onPointerLeave(); render();
		expect(preview()).toEqual(createDefaultChatProfile());
		button('Robot color: Pink').props.onClick(); render();
		button('Robot color: Sky').props.onPointerEnter(); render();
		button('Robot color: Sky').props.onPointerLeave(); render();
		expect(preview().robotColor).toBe('f5a8d2');
	});
	it('previews colors on keyboard focus and restores on blur', () => {
		render(); button('Name color: Sky').props.onFocus(); render();
		expect(preview().nameColor).toBe('a9d8ff');
		button('Name color: Sky').props.onBlur(); render();
		expect(preview()).toEqual(createDefaultChatProfile());
	});
	it('previews part options on hover and focus but only commits a click', () => {
		render(); button('Head').props.onClick(); render();
		const option = () => find(node => node.props.role === 'option' && node.props['data-value'] === 'round02');
		option().props.onPointerEnter(); render();
		expect(preview().face).toBe('round02');
		expect(option().props['aria-selected']).toBe(false);
		option().props.onPointerLeave(); render(); expect(preview().face).toBe('square01');
		option().props.onFocus(); render(); expect(preview().face).toBe('round02');
		option().props.onClick(); render(); submit();
		expect(props.onSave).toHaveBeenCalledWith('Alex', expect.objectContaining({ face: 'round02' }));
		expect(nodes(tree).some(node => node.props.role === 'listbox')).toBe(false);
	});
	it('randomizes valid profile choices without changing the display name', () => {
		render(); changeName('Keep me'); button('Randomize avatar').props.onClick(); render(); submit();
		const [name, profile] = vi.mocked(props.onSave).mock.calls[0];
		expect(name).toBe('Keep me'); expect(isChatProfile(profile)).toBe(true);
	});
	it('traps focus, uses latest close callback, and restores focus and body scroll on cleanup', () => {
		render(); expect(doc.body.style.overflow).toBe('hidden'); expect(doc.activeElement).toBe(nameInput);
		const event = { key: 'Tab', shiftKey: true, preventDefault: vi.fn() };
		listeners.get('keydown')!(event); expect(event.preventDefault).toHaveBeenCalled(); expect(doc.activeElement).toBe(last);
		listeners.get('keydown')!({ ...event, shiftKey: false }); expect(doc.activeElement).toBe(nameInput);
		props = { ...props, onClose: vi.fn() }; render();
		listeners.get('keydown')!({ key: 'Escape', preventDefault() {} }); expect(props.onClose).toHaveBeenCalledTimes(1);
		unmount(); expect(trigger.focus).toHaveBeenCalled(); expect(doc.body.style.overflow).toBe('auto'); expect(listeners.size).toBe(0);
	});
	it('closes only on backdrop clicks and does not steal focus from another surface', () => {
		render(); const backdrop = find(node => node.props.className === 'profile-editor-backdrop');
		backdrop.props.onClick({ target: {}, currentTarget: dialog }); expect(props.onClose).not.toHaveBeenCalled();
		backdrop.props.onClick({ target: dialog, currentTarget: dialog }); expect(props.onClose).toHaveBeenCalledTimes(1);
		doc.activeElement = {}; unmount(); expect(trigger.focus).not.toHaveBeenCalled();
	});
	it('restores focus after the focused dialog is detached, but not after focus left it', () => {
		render();
		doc.activeElement = doc.body;
		unmount(); expect(trigger.focus).toHaveBeenCalledTimes(1);
	});
	it('does not return focus after another surface previously took focus', () => {
		render(); doc.activeElement = {}; listeners.get('focusin')!({});
		doc.activeElement = doc.body;
		unmount(); expect(trigger.focus).not.toHaveBeenCalled();
	});
	it('keeps swatches interactive offline and saves their scalar values after reconnect', () => {
		props.ready = false; render();
		button('Robot color: Pink').props.onClick(); render();
		button('Background: Cloud').props.onClick(); render();
		button('Name color: Sky').props.onClick(); render();
		props.ready = true; render(); submit();
		expect(props.onSave).toHaveBeenCalledWith('Alex', expect.objectContaining({ robotColor: 'f5a8d2', backgroundColor: 'f1f4f6', nameColor: 'a9d8ff' }));
		expect(props.profile).toEqual(createDefaultChatProfile());
	});
});
