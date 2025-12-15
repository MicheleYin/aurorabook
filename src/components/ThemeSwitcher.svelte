<script lang="ts">
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Monitor from "@lucide/svelte/icons/monitor";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";
  import type { UITheme } from "$lib/types/ui";

  interface Props {
    value: UITheme;
    onChange: (theme: UITheme) => void;
  }

  let { value, onChange }: Props = $props();

  const options: Array<{ id: UITheme; Icon: typeof Sun; label: string }> = [
    { id: "light", Icon: Sun, label: "Light" },
    { id: "dark", Icon: Moon, label: "Dark" },
    { id: "system", Icon: Monitor, label: "System" },
  ];
</script>

<div class="inline-flex items-center gap-1 rounded-lg border border-border bg-card/60 p-1 backdrop-blur">
  {#each options as option}
    {@const Icon = option.Icon}
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={option.id === value}
      onclick={() => onChange(option.id)}
      class={cn(
        "h-8 w-8 px-0 text-muted-foreground relative overflow-hidden transition-all duration-300",
        option.id === value && "bg-primary/10 text-primary"
      )}
      aria-label="Switch to {option.label} theme"
    >
      <span
        class={cn(
          "relative z-10 transition-opacity duration-300",
          option.id === value ? "opacity-100" : "opacity-60"
        )}
      >
        <Icon class="h-4 w-4" aria-hidden="true" />
      </span>
      <span class="sr-only">{option.label}</span>
    </Button>
  {/each}
</div>

