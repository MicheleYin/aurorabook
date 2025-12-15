<script lang="ts">
	type ActiveView = 'library' | 'reader' | 'settings';
	export let activeView: ActiveView = 'library';
	import { activeBookId } from '$lib/stores/reader.js';
	import { Button } from '$lib/components/ui/button.svelte';
	import { cn } from '$lib/utils';

	const navItems: Array<{ id: ActiveView; label: string }> = [
		{ id: 'library', label: 'Library' },
		{ id: 'reader', label: 'Reader' },
		{ id: 'settings', label: 'Settings' }
	];

	$: readerDisabled = !$activeBookId;
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 sm:px-6">
	<div
		class="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-lg ring-1 ring-black/5 backdrop-blur-xl transition-[backdrop-filter] duration-300 ease-in-out"
	>
		{#each navItems as item}
			{@const isActive = activeView === item.id}
			{@const isDisabled = item.id === 'reader' && readerDisabled}
			<Button
				type="button"
				disabled={isDisabled}
				onclick={() => {
					if (!isDisabled) {
						activeView = item.id;
					}
				}}
				variant={isActive ? 'default' : 'ghost'}
				size="sm"
				class={cn(
					'rounded-full px-4 py-1.5 text-sm font-medium',
					isActive && 'shadow-sm',
					isDisabled && 'cursor-not-allowed opacity-50'
				)}
				title={isDisabled && item.id === 'reader' ? 'Open a book to enter the reader' : undefined}
				aria-label={isDisabled && item.id === 'reader' ? 'Open a book to enter the reader' : `Navigate to ${item.label}`}
				aria-current={isActive ? 'page' : undefined}
			>
				{item.label}
			</Button>
		{/each}
	</div>
</div>

