import { ChangeEvent, ReactNode } from "react";
import { Search, X } from "lucide-react";
import { anim } from "../../lib/animations";

interface LibrarySearchBarProps {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  actionsSlot?: ReactNode;
}

export function LibrarySearchBar({
  value,
  placeholder = "Search by title or author",
  onChange,
  disabled,
  actionsSlot,
}: LibrarySearchBarProps) {
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.target.value);
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="relative w-full sm:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={value}
          onChange={handleInputChange}
          disabled={disabled}
          placeholder={placeholder}
          className={anim("normal", "all", "w-full rounded-lg border border-border bg-card py-2 pl-10 pr-10 text-sm outline-none ring-offset-background focus:border-primary focus:ring-2 focus:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50")}
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className={anim("normal", "colors", "absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted")}
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      {actionsSlot ? <div className="flex items-center gap-2">{actionsSlot}</div> : null}
    </div>
  );
}
