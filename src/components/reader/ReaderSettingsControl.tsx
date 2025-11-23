import { useCallback, useEffect, useRef } from "react";
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
import {
  contentPaddingOptions,
  fontClassMap,
  fontOptions,
  fontPreviewText,
  fontSizeClassMap,
  fontSizeOptions,
  themeOptions,
} from "./constants";

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
  const themeOptionRefs = useRef<
    Record<ReaderPreferences["theme"], HTMLButtonElement | null>
  >({
    system: null,
    light: null,
    dark: null,
    sepia: null,
  });
  const fontSizeOptionRefs = useRef<
    Record<ReaderPreferences["fontSize"], HTMLButtonElement | null>
  >({
    small: null,
    medium: null,
    large: null,
    xlarge: null,
  });
  const contentPaddingOptionRefs = useRef<
    Record<ReaderPreferences["contentPadding"], HTMLButtonElement | null>
  >({
    compact: null,
    comfortable: null,
    spacious: null,
  });

  const scrollActiveOptions = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const nodes = [
        themeOptionRefs.current[preferences.theme],
        fontOptionRefs.current[preferences.fontFamily],
        fontSizeOptionRefs.current[preferences.fontSize],
        contentPaddingOptionRefs.current[preferences.contentPadding],
      ];

      nodes.forEach((node) =>
        node?.scrollIntoView({ behavior, inline: "center", block: "nearest" }),
      );
    },
    [
      preferences.theme,
      preferences.fontFamily,
      preferences.fontSize,
      preferences.contentPadding,
    ],
  );

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => scrollActiveOptions());
    return () => cancelAnimationFrame(frame);
  }, [isOpen, scrollActiveOptions]);

  const settingsBody = (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">
          Theme
        </h3>
        <div className="overflow-x-auto whitespace-nowrap pb-2 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex gap-2">
            {themeOptions.map((option) => (
              <Button
                key={option.id}
                ref={(node) => {
                  themeOptionRefs.current[option.id] = node;
                }}
                size="sm"
                variant={preferences.theme === option.id ? "secondary" : "ghost"}
                onClick={() => onPreferencesChange({ theme: option.id })}
                className="min-w-[140px] flex-shrink-0 snap-start flex-col items-start gap-2 px-4 py-3 text-left h-auto"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={cn(
                      "size-4 rounded-full border",
                      option.id === "system" &&
                        "bg-gradient-to-br from-white via-[#f4ecd8] to-zinc-900 border-slate-300",
                      option.id === "light" && "bg-white border-slate-300",
                      option.id === "dark" && "bg-zinc-900 border-zinc-700",
                      option.id === "sepia" && "bg-[#f4ecd8] border-[#e0cfb0]",
                    )}
                  />
                  <span className="font-medium">{option.label}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {option.id === "system"
                    ? "Match device theme"
                    : option.id === "light"
                      ? "Bright background"
                      : option.id === "dark"
                        ? "Low-light friendly"
                        : "Warm sepia tone"}
                </span>
              </Button>
            ))}
          </div>
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
                className="min-w-[140px] flex-shrink-0 snap-start flex-col items-start gap-1 h-auto"
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

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">
          Text size
        </h3>
        <div className="overflow-x-auto whitespace-nowrap pb-2 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex gap-2">
            {fontSizeOptions.map((option) => (
              <Button
                key={option.id}
                ref={(node) => {
                  fontSizeOptionRefs.current[option.id] = node;
                }}
                size="sm"
                variant={preferences.fontSize === option.id ? "secondary" : "ghost"}
                className="min-w-[140px] flex-shrink-0 snap-start flex-col items-start gap-1 px-4 py-3 text-left h-auto"
                onClick={() => onPreferencesChange({ fontSize: option.id })}
              >
                <span className={cn("font-semibold leading-none", fontSizeClassMap[option.id])}>
                  Aa
                </span>
                <span className="text-xs font-medium">{option.label}</span>
                <span className="text-[11px] text-muted-foreground">{option.description}</span>
              </Button>
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase text-muted-foreground">
          Page padding
        </h3>
        <div className="overflow-x-auto whitespace-nowrap pb-2 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex gap-2">
            {contentPaddingOptions.map((option) => (
              <Button
                key={option.id}
                ref={(node) => {
                  contentPaddingOptionRefs.current[option.id] = node;
                }}
                size="sm"
                variant={
                  preferences.contentPadding === option.id ? "secondary" : "ghost"
                }
                className="min-w-[140px] flex-shrink-0 snap-start flex-col items-start gap-2 px-4 py-3 text-left h-auto"
                onClick={() => onPreferencesChange({ contentPadding: option.id })}
              >
                <span className="flex h-8 w-full items-center justify-center">
                  <span className="relative flex h-6 w-full items-center justify-center rounded border border-border/60 bg-muted/30">
                    <span
                      className={cn(
                        "h-3 rounded bg-muted-foreground/40 transition-all",
                        option.id === "compact" && "w-20",
                        option.id === "comfortable" && "w-14",
                        option.id === "spacious" && "w-10",
                      )}
                    />
                  </span>
                </span>
                <span className="text-xs font-medium">{option.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {option.description}
                </span>
              </Button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange} >
      <DrawerTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="sm:mr-2 h-4 w-4" />
          <span className="hidden sm:block">Reader settings</span>
        </Button>
      </DrawerTrigger>
      <DrawerContent backdropBlur={false}>
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
