import type { UserRole } from "../../stream/playlist";

const storagePrefix = "watchparty-password";

export function getSavedPassword(mode: UserRole): string {
	return localStorage.getItem(getStorageKey(mode)) ?? "";
}

export function savePassword(mode: UserRole, password: string): void {
	localStorage.setItem(getStorageKey(mode), password);
}

export function clearSavedPassword(mode: UserRole): void {
	localStorage.removeItem(getStorageKey(mode));
}

function getStorageKey(mode: UserRole): string {
	return `${storagePrefix}:${mode}`;
}
