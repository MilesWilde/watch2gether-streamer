import { useCallback, useEffect, useState } from 'react';
import { isTheaterShortcut, readWatchPreferences, writeWatchPreferences, type WatchPreferences } from '../lib/watchPreferences';

export function useWatchPreferences(active: boolean) {
	const [preferences, setPreferences] = useState(() => readWatchPreferences());
	const updatePreferences = useCallback((changes: Partial<WatchPreferences>) => {
		setPreferences(previous => ({ ...previous, ...changes }));
	}, []);
	const toggleTheater = useCallback(() => {
		setPreferences(previous => ({ ...previous, theater: !previous.theater }));
	}, []);

	useEffect(() => { writeWatchPreferences(preferences); }, [preferences]);
	useEffect(() => {
		if (!active || typeof document === 'undefined') return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isTheaterShortcut(event) || document.querySelector?.('[role="dialog"], dialog[open], .watch-settings-panel')) return;
			event.preventDefault();
			toggleTheater();
		};
		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, [active, toggleTheater]);

	return { preferences, updatePreferences, toggleTheater };
}
