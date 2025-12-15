<script lang="ts">
	import { onMount } from 'svelte';
	import { activeBookId, setActiveBook } from '$lib/stores/reader.js';
	import { library, refreshLibrary } from '$lib/stores/library.js';
	import LibraryPanel from '$lib/components/app/LibraryPanel.svelte';
	import ReaderPanel from '$lib/components/app/ReaderPanel.svelte';
	import SettingsPanel from '$lib/components/app/SettingsPanel.svelte';
	import NavigationBar from '$lib/components/app/NavigationBar.svelte';
	import Toaster from '$lib/components/ui/Toaster.svelte';

	type ActiveView = 'library' | 'reader' | 'settings';

	let activeView: ActiveView = 'library';

	// Auto-navigate to reader when a book is opened
	$: if ($activeBookId && activeView !== 'reader') {
		activeView = 'reader';
	} else if (!$activeBookId && activeView === 'reader') {
		activeView = 'library';
	}
</script>

<div class="flex min-h-screen flex-col bg-background text-foreground">
	<div class="mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
		<div class="flex flex-1 min-h-0 flex-col">
			{#if activeView === 'library'}
				<LibraryPanel />
			{:else if activeView === 'reader'}
				<ReaderPanel />
			{:else if activeView === 'settings'}
				<SettingsPanel />
			{/if}
		</div>
	</div>

	<NavigationBar bind:activeView />
	<Toaster />
</div>

