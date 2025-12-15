# shadcn-svelte Components Setup

## ✅ Installed Components

The following shadcn-svelte components have been set up:

1. **Button** (`src/lib/components/ui/button.svelte`)
   - Variants: default, destructive, outline, secondary, ghost, link
   - Sizes: default, sm, lg, icon
   - Used in: NavigationBar, LibraryPanel, SettingsPanel

2. **Card** (`src/lib/components/ui/card.svelte`)
   - Basic card container
   - Used in: LibraryPanel, SettingsPanel

3. **Dialog** (`src/lib/components/ui/dialog.svelte`)
   - Modal dialog component using bits-ui
   - Ready for use in dialogs and modals

4. **Toast** (`src/lib/components/ui/toast.svelte`)
   - Toast notification component
   - Used in: Toaster component

## 📦 Dependencies

All required dependencies are in `package.json`:
- `bits-ui` - Headless UI primitives for dialogs, dropdowns, etc.
- `clsx` - Class name utility
- `tailwind-merge` - Tailwind class merging

Note: `vaul-svelte` can be added later when drawer components are needed.

## 🚀 Adding More Components

To add more shadcn-svelte components:

1. Visit [shadcn-svelte.com](https://www.shadcn-svelte.com)
2. Copy the component code
3. Place it in `src/lib/components/ui/`
4. Export from `src/lib/components/ui/index.ts` if needed

## 📝 Usage Examples

### Button
```svelte
<script>
  import { Button } from '$lib/components/ui/button.svelte';
</script>

<Button variant="default" size="lg">Click me</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Cancel</Button>
```

### Card
```svelte
<script>
  import { Card } from '$lib/components/ui/card.svelte';
</script>

<Card>
  <div class="p-4">
    <h3>Card Title</h3>
    <p>Card content</p>
  </div>
</Card>
```

### Dialog
```svelte
<script>
  import { Dialog } from '$lib/components/ui/dialog.svelte';
  import { Button } from '$lib/components/ui/button.svelte';
  
  let open = $state(false);
</script>

<Dialog bind:open>
  <div class="p-4">
    <h2>Dialog Title</h2>
    <p>Dialog content</p>
    <Button onclick={() => open = false}>Close</Button>
  </div>
</Dialog>
```

## 🎨 Styling

All components use Tailwind CSS with CSS variables for theming. The theme is defined in `src/app.css` and supports light/dark modes.

## 🔧 Configuration

The `components.json` file configures:
- Component aliases
- Tailwind CSS setup
- Base color scheme (neutral)
- CSS variables enabled

