# shadcn-svelte Setup

This project uses shadcn-svelte components. The basic setup is complete, but you can add more components as needed.

## Adding Components

To add more shadcn-svelte components, you can either:

1. **Use the CLI** (if available):
   ```bash
   npx shadcn-svelte@latest add button
   ```

2. **Copy components manually** from [shadcn-svelte.com](https://www.shadcn-svelte.com)

## Currently Installed Components

- `button.svelte` - Button component with variants
- `card.svelte` - Card container component
- `dialog.svelte` - Dialog/Modal component (using bits-ui)
- `toast.svelte` - Toast notification component

## Dependencies

The following packages are required for shadcn-svelte:
- `bits-ui` - Headless UI primitives
- `clsx` - Class name utility
- `tailwind-merge` - Tailwind class merging utility

Note: `vaul-svelte` can be added later when drawer components are needed. Check npm for the correct version.

## Usage

Import components from `$lib/components/ui`:

```svelte
<script>
  import { Button } from '$lib/components/ui/button.svelte';
  import { Card } from '$lib/components/ui/card.svelte';
</script>

<Card>
  <Button>Click me</Button>
</Card>
```

