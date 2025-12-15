<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { loadSettings, resolvedTheme } from '$lib/stores/settings.js';
	import { refreshLibrary } from '$lib/stores/library.js';
	import { UITheme } from '$lib/types/settings.js';
	import '../app.css';

	onMount(async () => {
		await loadSettings();
		await refreshLibrary();
	});

	// Apply theme to document
	$: if (browser) {
		const isDark = $resolvedTheme === UITheme.Dark;
		document.documentElement.classList.toggle('dark', isDark);
	}
</script>

<slot />

