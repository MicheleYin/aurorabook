import { Badge } from "@/components/ui/badge";
import { cn, type LibraryBookStatus } from "@/lib/utils";

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

type LibraryStatusBadgeProps = {
  status: LibraryBookStatus;
  className?: string;
};

export function LibraryStatusBadge({ status, className }: LibraryStatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <Badge
      variant={meta.variant}
      className={cn(
        "pointer-events-none text-[10px] uppercase tracking-wide shadow-sm",
        meta.className,
        className,
      )}
      aria-label={meta.label}
    >
      {meta.label}
    </Badge>
  );
}


