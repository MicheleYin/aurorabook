<script lang="ts">
	import { library, isLoadingLibrary } from '$lib/stores/library.js';
	import { setActiveBook } from '$lib/stores/reader.js';
	import type { Book } from '$lib/types/index.js';
	import { Card } from '$lib/components/ui/card.svelte';
	import { Button } from '$lib/components/ui/button.svelte';
</script>

<div class="flex flex-col gap-4">
	<h1 class="text-2xl font-bold">Library</h1>
	{#if $isLoadingLibrary}
		<p>Loading...</p>
	{:else if $library.length === 0}
		<p>No books in library</p>
	{:else}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
			{#each $library as book (book.id)}
				<Card>
					<div class="p-4">
						<h3 class="font-semibold">{book.title}</h3>
						<p class="text-sm text-muted-foreground">{book.author}</p>
						<Button onclick={() => setActiveBook(book)} class="mt-4 w-full">
							Open
						</Button>
					</div>
				</Card>
			{/each}
		</div>
	{/if}
</div>

