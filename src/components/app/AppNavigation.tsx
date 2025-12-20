import { memo } from "react";
import { cn } from "../../lib/utils";

type AppNavigationProps = {
  currentView: "library" | "reader" | "settings";
  onViewChange: (view: "library" | "reader" | "settings") => void;
};

export const AppNavigation = memo(function AppNavigation({
  currentView,
  onViewChange,
}: AppNavigationProps) {
  const items = [
    { id: "library" as const, label: "Library" },
    { id: "reader" as const, label: "Reader" },
    { id: "settings" as const, label: "Settings" },
  ];

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 sm:px-6 pointer-events-none">
      <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-lg backdrop-blur-xl">
        {items.map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
