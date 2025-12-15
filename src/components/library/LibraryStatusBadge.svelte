<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { cn } from "$lib/utils";
  import type { LibraryBookStatus } from "$lib/types/library";

  interface Props {
    status: LibraryBookStatus;
    className?: string;
  }

  let { status, className }: Props = $props();

  const STATUS_META: Record<
    LibraryBookStatus,
    {
      label: string;
      variant: "default" | "secondary" | "destructive" | "outline";
      className?: string;
    }
  > = {
    new: {
      label: "New",
      variant: "default",
      className: "bg-emerald-500 text-white border-transparent",
    },
    resume: {
      label: "Resume",
      variant: "default",
      className: "bg-amber-500 text-white border-transparent",
    },
    finished: {
      label: "Finished",
      variant: "default",
      className: "bg-blue-500 text-white border-transparent",
    },
  };

  const meta = STATUS_META[status];
</script>

<Badge
  variant={meta.variant}
  class={cn(
    "pointer-events-none text-[10px] uppercase tracking-wide shadow-sm",
    meta.className,
    className,
  )}
  aria-label={meta.label}
>
  {meta.label}
</Badge>

