<script lang="ts">
	import { toasts, removeToast } from '$lib/stores/toast.js';
	import Toast from './toast.svelte';
	import { Button } from './button.svelte';
</script>

<div class="fixed bottom-0 right-0 z-50 flex flex-col gap-2 p-4">
	{#each $toasts as toast (toast.id)}
		<Toast variant={toast.type === 'error' ? 'destructive' : 'default'}>
			<div class="grid gap-1">
				<div class="text-sm font-semibold">{toast.title}</div>
				{#if toast.description}
					<div class="text-sm opacity-90">{toast.description}</div>
				{/if}
			</div>
			<Button
				variant="ghost"
				size="icon"
				onclick={() => removeToast(toast.id)}
				class="absolute right-2 top-2"
			>
				×
			</Button>
		</Toast>
	{/each}
</div>

