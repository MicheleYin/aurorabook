<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	interface ToastProps extends HTMLAttributes<HTMLDivElement> {
		class?: string;
		variant?: 'default' | 'destructive';
	}

	let {
		class: className = '',
		variant = 'default',
		children,
		...restProps
	}: ToastProps = $props();
</script>

<div
	class={cn(
		'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all',
		variant === 'destructive' && 'destructive group border-destructive bg-destructive text-destructive-foreground',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>

