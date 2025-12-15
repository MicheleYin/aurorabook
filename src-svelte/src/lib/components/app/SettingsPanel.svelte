<script lang="ts">
	import { settings, updateSettings } from '$lib/stores/settings.js';
	import { UITheme } from '$lib/types/settings.js';
	import { Card } from '$lib/components/ui/card.svelte';
	import { Button } from '$lib/components/ui/button.svelte';
</script>

<div class="flex flex-col gap-4">
	<h1 class="text-2xl font-bold">Settings</h1>
	<div class="space-y-4">
		<Card>
			<div class="p-4">
				<label class="block text-sm font-medium mb-2">Theme</label>
				<select
					value={$settings.theme}
					onchange={(e) => updateSettings({ theme: (e.target as HTMLSelectElement).value as UITheme })}
					class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<option value={UITheme.Light}>Light</option>
					<option value={UITheme.Dark}>Dark</option>
					<option value={UITheme.System}>System</option>
				</select>
			</div>
		</Card>
	</div>
</div>

