import type { ReactNode } from "react";
import { memo, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import type { UITheme } from "../types/ui";
import { anim } from "../lib/animations";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface ThemeSwitcherProps {
  value: UITheme;
  onChange: (theme: UITheme) => void;
}

const options: Array<{ id: UITheme; icon: ReactNode; label: string }> = [
  {
    id: "light",
    icon: <Sun className="h-4 w-4" aria-hidden="true" />,
    label: "Light",
  },
  {
    id: "dark",
    icon: <Moon className="h-4 w-4" aria-hidden="true" />,
    label: "Dark",
  },
  {
    id: "system",
    icon: <Monitor className="h-4 w-4" aria-hidden="true" />,
    label: "System",
  },
];

function ThemeSwitcherComponent({ value, onChange }: ThemeSwitcherProps) {
  const [previousValue, setPreviousValue] = useState<UITheme>(value);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (previousValue !== value) {
      setIsTransitioning(true);
      const timer = setTimeout(() => {
        setIsTransitioning(false);
        setPreviousValue(value);
      }, 300); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [value, previousValue]);

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card/60 p-1 backdrop-blur">
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
              "h-8 w-8 px-0 text-muted-foreground relative overflow-hidden",
              anim("medium", "all"),
              isActive && "bg-primary/10 text-primary",
              isTransitioning && isActive && "animate-pulse"
            )}
            aria-label={`Switch to ${option.label} theme`}
          >
            <span
              className={cn(
                "relative z-10 transition-opacity duration-300",
                isActive ? "opacity-100" : "opacity-60"
              )}
            >
              {option.icon}
            </span>
            <span className="sr-only">{option.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

export const ThemeSwitcher = memo(
  ThemeSwitcherComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.value === nextProps.value &&
      prevProps.onChange === nextProps.onChange
    );
  }
);
