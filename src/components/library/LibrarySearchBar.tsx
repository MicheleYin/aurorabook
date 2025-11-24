import { ChangeEvent, ReactNode } from "react";
import { Search, X } from "lucide-react";
import { anim } from "../../lib/animations";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";

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
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={value}
          onChange={handleInputChange}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            anim("normal", "all"),
            "pl-10 pr-10 rounded-lg bg-card focus:border-primary focus:ring-primary/40",
            // Hide native browser clear button for search inputs
            "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          )}
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className={cn(
              anim("normal", "colors"),
              "absolute right-2 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            )}
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
