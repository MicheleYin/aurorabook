import { useRef } from "react";
import { Settings2, X } from "lucide-react";

import type { ReaderPreferences } from "../../types/reader";
import { cn } from "../../lib/utils";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerHeader as DrawerModalHeader,
  DrawerTitle,
  DrawerTrigger,
} from "../ui/drawer";
import { Button } from "../ui/button";
import { fontClassMap, fontOptions, fontPreviewText, themeOptions } from "./constants";

import type { ReaderPanelBaseProps } from "./types";

type ReaderSettingsControlProps = {
  preferences: ReaderPreferences;
  onPreferencesChange: ReaderPanelBaseProps["onPreferencesChange"];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ReaderSettingsControl({
  preferences,
  onPreferencesChange,
  isOpen,
  onOpenChange,
}: ReaderSettingsControlProps) {
  const fontOptionRefs = useRef<
    Record<ReaderPreferences["fontFamily"], HTMLButtonElement | null>
  >({
    merriweather: null,
    inter: null,
    lora: null,
    firaMono: null,
    atkinson: null,
  });

  const settingsBody = (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">
          Theme
        </h3>
        <div className="flex flex-wrap gap-2">
          {themeOptions.map((option) => (
            <Button
              key={option.id}
              size="sm"
              variant={preferences.theme === option.id ? "secondary" : "ghost"}
              onClick={() => onPreferencesChange({ theme: option.id })}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-4 rounded-full border",
                    option.id === "light" && "bg-white border-slate-300",
                    option.id === "dark" && "bg-zinc-900 border-zinc-700",
                    option.id === "sepia" && "bg-[#f4ecd8] border-[#e0cfb0]",
                  )}
                />
                {option.label}
              </span>
            </Button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">
          Font
        </h3>
        <div className="overflow-x-auto whitespace-nowrap pb-2 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex gap-2">
            {fontOptions.map((option) => (
              <Button
                key={option.id}
                ref={(node) => {
                  fontOptionRefs.current[option.id] = node;
                }}
                size="sm"
                variant={preferences.fontFamily === option.id ? "secondary" : "ghost"}
                onClick={() => onPreferencesChange({ fontFamily: option.id })}
                className="min-w-[140px] flex-shrink-0 snap-start flex-col items-start gap-1"
              >
                <span className={cn("text-lg leading-none", fontClassMap[option.id])}>
                  {fontPreviewText[option.id]}
                </span>
                <span className="text-xs text-muted-foreground">{option.label}</span>
              </Button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="mr-2 h-4 w-4" />
          Reader settings
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHandle className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-muted" />
        <DrawerModalHeader className="flex flex-row items-start justify-between text-left">
          <div>
            <DrawerTitle className="text-lg font-semibold">Reader preferences</DrawerTitle>
            <DrawerDescription>
              Personalise the reading experience to match your environment.
            </DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close reader settings">
              <X className="h-4 w-4" />
            </Button>
          </DrawerClose>
        </DrawerModalHeader>
        <div className="mt-4 max-h-[65vh] overflow-y-auto pr-2">
          {settingsBody}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
