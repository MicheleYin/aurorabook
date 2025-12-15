<script lang="ts">
	import * as Dialog from 'bits-ui';
	import { cn } from '$lib/utils';
	import type { HTMLAttributes } from 'svelte/elements';

	interface DialogProps {
		open?: boolean;
		onOpenChange?: (open: boolean) => void;
	}

	interface DialogContentProps extends HTMLAttributes<HTMLDivElement> {
		class?: string;
	}

	let {
		open = $bindable(false),
		onOpenChange
	}: DialogProps = $props();

	let {
		class: className = '',
		children,
		...restProps
	}: DialogContentProps = $props();
</script>

<Dialog.Root {open} onOpenChange={onOpenChange}>
	<Dialog.Portal>
		<Dialog.Overlay
			class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
		/>
		<Dialog.Content
			class={cn(
				'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
				className
			)}
			{...restProps}
		>
			{@render children?.()}
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>

