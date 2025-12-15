<script lang="ts">
	import { activeBook } from '$lib/stores/reader.js';

	// Placeholder - will be fully implemented
</script>

{#if $activeBook}
	<div class="flex flex-col gap-4">
		<h1 class="text-2xl font-bold">Reader</h1>
		<p>Reading: {$activeBook.title}</p>
		<p class="text-sm text-muted-foreground">Reader view will be implemented here</p>
	</div>
{:else}
	<div class="flex flex-col items-center justify-center gap-4">
		<p class="text-muted-foreground">No book selected</p>
	</div>
{/if}

