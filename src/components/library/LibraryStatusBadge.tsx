import { cn, type LibraryBookStatus } from "../../lib/utils";

const STATUS_META: Record<
  LibraryBookStatus,
  {
    label: string;
    className: string;
  }
> = {
  new: {
    label: "New",
    className: "bg-emerald-500 text-white",
  },
  resume: {
    label: "Resume",
    className: "bg-amber-500 text-white",
  },
  finished: {
    label: "Finished",
    className: "bg-blue-500 text-white",
  },
};

type LibraryStatusBadgeProps = {
  status: LibraryBookStatus;
  className?: string;
};

export function LibraryStatusBadge({ status, className }: LibraryStatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "pointer-events-none inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide shadow-sm",
        meta.className,
        className,
      )}
      aria-label={meta.label}
    >
      {meta.label}
    </span>
  );
}


