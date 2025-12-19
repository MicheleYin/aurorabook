import { memo } from "react";
import { cn } from "../../lib/utils";
import { animPatterns } from "../../lib/animations";

type NavigationItem = {
  id: string;
  label: string;
  disabled?: boolean;
};

type AppNavigationProps = {
  navigationItems: NavigationItem[];
  activeView: string;
  hideNavigation: boolean;
  onNavigate: (viewId: string) => Promise<void>;
};

export const AppNavigation = memo(function AppNavigation({
  navigationItems,
  activeView,
  hideNavigation,
  onNavigate,
}: AppNavigationProps) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 sm:px-6",
        animPatterns.navBar,
        hideNavigation ? "nav-bar-exit" : "nav-bar-enter"
      )}
    >
      <div
        className={cn(
          "pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-card/80 p-1 shadow-lg ring-1 ring-black/5",
          hideNavigation ? "backdrop-blur-sm" : "backdrop-blur-xl",
          "transition-[backdrop-filter] duration-300 ease-in-out",
          hideNavigation && "pointer-events-none"
        )}
      >
        {navigationItems.map((item) => {
          const isActive = activeView === item.id;
          const isDisabled = Boolean(item.disabled);
          return (
            <button
              key={item.id}
              type="button"
              disabled={isDisabled}
              onClick={async () => {
                if (isDisabled) return;
                await onNavigate(item.id);
              }}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium",
                animPatterns.buttonHover,
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted",
                isDisabled && "cursor-not-allowed opacity-50 hover:bg-transparent"
              )}
              title={
                item.id === "reader" && isDisabled
                  ? "Open a book to enter the reader"
                  : undefined
              }
              aria-label={
                item.id === "reader" && isDisabled
                  ? "Open a book to enter the reader"
                  : `Navigate to ${item.label}`
              }
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

