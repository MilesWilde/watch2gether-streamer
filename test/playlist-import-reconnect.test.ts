import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode, ReactPortal, SyntheticEvent } from 'react';
import { PlaylistImportModal } from '../src/client/components/PlaylistImportModal';
import { RequestVideoPanel } from '../src/client/components/RequestVideoPanel';
import { WatchPartyApp } from '../src/client/WatchPartyApp';
import type { ServerMessage } from '../src/stream/messages';
import type { YouTubePlaylistPreview } from '../src/stream/youtube-playlists';

const hooks = vi.hoisted(() => ({
	slots: [] as { value?: unknown; deps?: readonly unknown[]; cleanup?: void | (() => void) }[], index: 0,
	effects: [] as (() => void)[],
}));
const previewApi = vi.hoisted(() => ({ fetchPlaylistPreview: vi.fn() }));
const connection = vi.hoisted(() => ({
	authenticated: true, chatReady: true, onMessage: undefined as undefined | ((message: ServerMessage) => void),
}));

vi.mock('../src/client/lib/youtubePlaylistPreview', () => previewApi);
vi.mock('../src/client/hooks/useWatchPartySocket', () => ({
	useWatchPartySocket: (options: { onMessage: (message: ServerMessage) => void }) => {
		connection.onMessage = options.onMessage;
		return { authenticated: connection.authenticated, status: 'Connected', send: vi.fn(), leave: vi.fn() };
	},
}));
vi.mock('../src/client/hooks/useRoomChat', () => ({
	useRoomChat: () => ({ ready: connection.chatReady, name: '', messages: [], sessionId: 'room', onMessage: vi.fn(), clear: vi.fn(), suspend: vi.fn() }),
}));
vi.mock('../src/client/hooks/useChatNotifications', () => ({
	useChatNotifications: () => ({ enabled: true, onMessage: vi.fn(), clear: vi.fn(), reset: vi.fn(), toggle: vi.fn() }),
}));
vi.mock('react', async importOriginal => {
	const original = await importOriginal<typeof import('react')>();
	function memo(factory: () => unknown, deps: readonly unknown[]) {
		const slot = hooks.slots[hooks.index++] ??= {};
		if (!slot.deps || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
			slot.value = factory();
			slot.deps = deps;
		}
		return slot.value;
	}
	return {
		...original,
		useMemo: memo,
		useCallback: (callback: unknown, deps: readonly unknown[]) => memo(() => callback, deps),
		useState: (initial: unknown) => {
			const slot = hooks.slots[hooks.index++] ??= { value: typeof initial === 'function' ? initial() : initial };
			return [slot.value, (next: unknown) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
		},
		useEffect: (callback: () => void | (() => void), deps: readonly unknown[]) => {
			const slot = hooks.slots[hooks.index++] ??= {};
			if (!slot.deps || deps.length !== slot.deps.length || deps.some((dep, index) => !Object.is(dep, slot.deps?.[index]))) {
				slot.deps = deps;
				hooks.effects.push(() => { slot.cleanup?.(); slot.cleanup = callback(); });
			}
		},
	};
});

type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
	if (!node || typeof node !== 'object') return [];
	if (Array.isArray(node)) return node.flatMap(elements);
	const element = node as Element;
	const children = 'containerInfo' in node ? (node as ReactPortal).children : element.props?.children;
	return [element, ...elements(children)];
}
function button(nodes: Element[], label: string) {
	const result = nodes.find(node => node.type === 'button' && node.props.children === label);
	expect(result, label).toBeDefined();
	return result!;
}
const preview: YouTubePlaylistPreview = {
	playlistId: 'PLtestplaylist', truncated: false,
	videos: Array.from({ length: 30 }, (_, i) => ({ videoId: `video-${i}`, title: `Video ${i}`, url: `https://www.youtube.com/watch?v=video-${i}` })),
};
const submitEvent = () => ({ preventDefault: vi.fn() }) as unknown as SyntheticEvent<HTMLFormElement>;

beforeEach(() => {
	hooks.slots = [];
	hooks.index = 0;
	hooks.effects = [];
	previewApi.fetchPlaylistPreview.mockReset().mockResolvedValue(preview);
	vi.stubGlobal('document', Object.assign(new EventTarget(), { body: { nodeType: 1 } }));
});
afterEach(() => {
	for (const slot of hooks.slots) slot.cleanup?.();
	vi.unstubAllGlobals();
});

describe('playlist import modal during reconnect', () => {
	let disabled: boolean;
	const onImport = vi.fn();
	const onClose = vi.fn();
	function render() {
		hooks.index = 0;
		return PlaylistImportModal({ preview, disabled, onImport, onClose });
	}
	beforeEach(() => { disabled = false; onImport.mockReset(); onClose.mockReset(); });

	it('portals to document.body outside the disabled support fieldset', () => {
		disabled = true;
		const result = render() as unknown as { $$typeof: symbol; containerInfo: unknown };
		expect(result.$$typeof).toBe(Symbol.for('react.portal'));
		expect(result.containerInfo).toBe(document.body);
		expect(elements(render()).some(node => node.type === 'fieldset')).toBe(false);
	});

	it('disables and guards only the server-mutating request while offline', () => {
		render();
		disabled = true;
		const nodes = elements(render());
		const request = button(nodes, 'Request videos');
		expect(request.props.disabled).toBe(true);
		request.props.onClick();
		expect(onImport).not.toHaveBeenCalled();
		for (const label of ['Close', 'Cancel', 'Clear visible', 'Show 25 more']) {
			expect(button(nodes, label).props.disabled).not.toBe(true);
		}
		button(nodes, 'Close').props.onClick();
		button(nodes, 'Cancel').props.onClick();
		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it('keeps selection and show-more usable offline and imports that draft after reconnect', () => {
		render();
		disabled = true;
		button(elements(render()), 'Clear visible').props.onClick();
		let nodes = elements(render());
		expect(nodes.filter(node => node.type === 'input').every(node => !node.props.checked)).toBe(true);
		nodes.find(node => node.type === 'input')!.props.onChange();
		button(elements(render()), 'Show 25 more').props.onClick();
		nodes = elements(render());
		expect(nodes.filter(node => node.type === 'input')).toHaveLength(30);
		button(nodes, 'Request videos').props.onClick();
		expect(onImport).not.toHaveBeenCalled();
		disabled = false;
		const request = button(elements(render()), 'Request videos');
		expect(request.props.disabled).not.toBe(true);
		request.props.onClick();
		expect(onImport).toHaveBeenCalledExactlyOnceWith([preview.videos[0], ...preview.videos.slice(25)].map(({ url, title }) => ({ url, title })));
	});
});

describe('request panel offline draft safety', () => {
	let disabled: boolean;
	const onSend = vi.fn();
	function render() {
		hooks.index = 0;
		return elements(RequestVideoPanel({ mode: 'viewer', password: 'password', disabled, onSend, onStatusChange: vi.fn() }));
	}
	function input() { return render().find(node => node.type === 'input')!; }
	function modal() { return render().find(node => node.type === PlaylistImportModal); }
	beforeEach(() => { disabled = false; onSend.mockReset(); });

	it('guards the parent import callback and retains preview and URL until connected submission', async () => {
		input().props.onChange({ currentTarget: { value: 'https://www.youtube.com/playlist?list=PLtestplaylist' } });
		await render().find(node => node.type === 'form')!.props.onSubmit(submitEvent());
		expect(modal()).toBeDefined();
		disabled = true;
		expect(modal()!.props.disabled).toBe(true);
		modal()!.props.onImport(preview.videos);
		expect(onSend).not.toHaveBeenCalled();
		expect(modal()!.props.preview).toBe(preview);
		expect(input().props.value).toContain('PLtestplaylist');
		disabled = false;
		modal()!.props.onImport(preview.videos);
		expect(onSend).toHaveBeenCalledExactlyOnceWith({ type: 'request_videos', videos: preview.videos });
		expect(modal()).toBeUndefined();
		expect(input().props.value).toBe('');
	});

	it.each(['https://www.youtube.com/watch?v=video-0', 'https://www.youtube.com/playlist?list=PLtestplaylist'])('guards direct offline form submission without discarding %s', async url => {
		input().props.onChange({ currentTarget: { value: url } });
		disabled = true;
		await render().find(node => node.type === 'form')!.props.onSubmit(submitEvent());
		expect(onSend).not.toHaveBeenCalled();
		expect(previewApi.fetchPlaylistPreview).not.toHaveBeenCalled();
		expect(input().props.value).toBe(url);
	});
});

it('passes controls readiness to the request panel through reconnect', () => {
	vi.stubGlobal('window', { location: { pathname: '/' } });
	vi.stubGlobal('localStorage', { getItem: () => 'password' });
	connection.authenticated = true;
	connection.chatReady = true;
	function render() {
		hooks.index = 0;
		const nodes = elements(WatchPartyApp());
		for (const effect of hooks.effects.splice(0)) effect();
		return nodes.find(node => node.type === RequestVideoPanel)?.props;
	}
	render();
	connection.onMessage!({ type: 'authenticated', role: 'viewer', listenerCount: 1, serverNowMs: 0 });
	expect(render()!.disabled).toBe(true);
	connection.onMessage!({ type: 'state', state: { playlist: [], requests: [], currentIndex: 0, playback: { playing: false, positionSec: 0, playbackRate: 1, updatedAtMs: 0 } } });
	expect(render()!.disabled).toBe(false);
	connection.authenticated = false;
	expect(render()!.disabled).toBe(true);
	connection.authenticated = true;
	connection.chatReady = false;
	expect(render()!.disabled).toBe(true);
	connection.chatReady = true;
	expect(render()!.disabled).toBe(false);
});
