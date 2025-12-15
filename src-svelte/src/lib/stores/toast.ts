import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
	id: string;
	type: ToastType;
	title: string;
	description?: string;
	duration?: number;
}

export const toasts = writable<Toast[]>([]);

let toastIdCounter = 0;

function createToast(
	type: ToastType,
	title: string,
	description?: string,
	duration = 5000
): string {
	const id = `toast-${toastIdCounter++}`;
	const toast: Toast = { id, type, title, description, duration };

	toasts.update((list) => [...list, toast]);

	if (duration > 0) {
		setTimeout(() => {
			removeToast(id);
		}, duration);
	}

	return id;
}

export function success(title: string, description?: string, duration?: number) {
	return createToast('success', title, description, duration);
}

export function error(title: string, description?: string, duration?: number) {
	return createToast('error', title, description, duration);
}

export function info(title: string, description?: string, duration?: number) {
	return createToast('info', title, description, duration);
}

export function warning(title: string, description?: string, duration?: number) {
	return createToast('warning', title, description, duration);
}

export function removeToast(id: string) {
	toasts.update((list) => list.filter((t) => t.id !== id));
}

