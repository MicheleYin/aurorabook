import { Monitor, Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import type { UITheme } from "../types/ui";

interface ThemeSwitcherProps {
  value: UITheme;
  onChange: (theme: UITheme) => void;
}

const options: Array<{ id: UITheme; icon: ReactNode; label: string }> = [
  { id: "light", icon: <Sun className="h-4 w-4" />, label: "Light" },
  { id: "dark", icon: <Moon className="h-4 w-4" />, label: "Dark" },
  { id: "system", icon: <Monitor className="h-4 w-4" />, label: "System" },
];

export function ThemeSwitcher({ value, onChange }: ThemeSwitcherProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 p-1 backdrop-blur">
      {options.map((option) => {
        const isActive = option.id === value;
        return (
          <Button
            key={option.id}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={isActive}
            onClick={() => onChange(option.id)}
            className={cn(
              "h-8 w-8 px-0 text-muted-foreground",
              isActive && "bg-primary/10 text-primary",
            )}
          >
            {option.icon}
            <span className="sr-only">{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
