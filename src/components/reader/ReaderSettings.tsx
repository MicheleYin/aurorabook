import { useEffect, useRef } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";

import { cn } from "../../lib/utils";
import { Card, CardContent } from "../ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Label } from "../ui/label";

export interface ReaderSettings {
  theme: string; // "light", "dark", "system"
  fontFamily: string; // "merriweather", "inter", etc.
  fontSize: string; // "small", "medium", "large", "xlarge"
  contentPadding: string; // "compact", "comfortable", "spacious"
}

interface ReaderSettingsProps {
  settings: ReaderSettings;
  onSettingsChange: (settings: ReaderSettings) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReaderSettings({
  settings,
  onSettingsChange,
  isOpen,
  onOpenChange,
}: Readonly<ReaderSettingsProps>) {
  const themeLightRef = useRef<HTMLDivElement>(null);
  const themeDarkRef = useRef<HTMLDivElement>(null);
  const themeSystemRef = useRef<HTMLDivElement>(null);
  const fontFamilyMerriweatherRef = useRef<HTMLDivElement>(null);
  const fontFamilyInterRef = useRef<HTMLDivElement>(null);
  const fontFamilyMonospaceRef = useRef<HTMLDivElement>(null);
  const fontSizeSmallRef = useRef<HTMLDivElement>(null);
  const fontSizeMediumRef = useRef<HTMLDivElement>(null);
  const fontSizeLargeRef = useRef<HTMLDivElement>(null);
  const fontSizeXlargeRef = useRef<HTMLDivElement>(null);
  const paddingCompactRef = useRef<HTMLDivElement>(null);
  const paddingComfortableRef = useRef<HTMLDivElement>(null);
  const paddingSpaciousRef = useRef<HTMLDivElement>(null);

  const handleThemeChange = (theme: string) => {
    onSettingsChange({ ...settings, theme });
  };

  const handleFontFamilyChange = (fontFamily: string) => {
    onSettingsChange({ ...settings, fontFamily });
  };

  const handleFontSizeChange = (fontSize: string) => {
    onSettingsChange({ ...settings, fontSize });
  };

  const handlePaddingChange = (contentPadding: string) => {
    onSettingsChange({ ...settings, contentPadding });
  };

  // Scroll to selected items when drawer opens
  useEffect(() => {
    if (!isOpen) return;

    const scrollToElement = (ref: React.RefObject<HTMLDivElement | null>) => {
      if (ref.current) {
        ref.current.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    };

    const scrollToSelected = () => {
      // Theme
      const themeRefs: Record<
        string,
        React.RefObject<HTMLDivElement | null>
      > = {
        light: themeLightRef,
        dark: themeDarkRef,
        system: themeSystemRef,
      };
      scrollToElement(themeRefs[settings.theme]);

      // Font Family
      const fontFamilyRefs: Record<
        string,
        React.RefObject<HTMLDivElement | null>
      > = {
        merriweather: fontFamilyMerriweatherRef,
        inter: fontFamilyInterRef,
        monospace: fontFamilyMonospaceRef,
      };
      scrollToElement(fontFamilyRefs[settings.fontFamily]);

      // Font Size
      const fontSizeRefs: Record<
        string,
        React.RefObject<HTMLDivElement | null>
      > = {
        small: fontSizeSmallRef,
        medium: fontSizeMediumRef,
        large: fontSizeLargeRef,
        xlarge: fontSizeXlargeRef,
      };
      scrollToElement(fontSizeRefs[settings.fontSize]);

      // Content Padding
      const paddingRefs: Record<
        string,
        React.RefObject<HTMLDivElement | null>
      > = {
        compact: paddingCompactRef,
        comfortable: paddingComfortableRef,
        spacious: paddingSpaciousRef,
      };
      scrollToElement(paddingRefs[settings.contentPadding]);
    };

    // Small delay to ensure drawer is fully rendered
    const timeoutId = setTimeout(scrollToSelected, 100);
    return () => clearTimeout(timeoutId);
  }, [isOpen]);

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHandle />
        <DrawerHeader className="pb-4">
          <DrawerTitle>Reader Settings</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-4 p-4 overflow-y-auto">
          {/* Theme */}
          <div className="space-y-2">
            <Label className="text-sm">Theme</Label>
            <div className="flex flex-row gap-2 overflow-x-auto p-1">
              <Card
                ref={themeLightRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-24",
                  settings.theme === "light" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleThemeChange("light")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-1 h-20">
                  <Sun className="h-3 w-3" />
                  <span className="text-xs font-medium">Light</span>
                  <div className="h-3 w-3 flex items-center justify-center">
                    {settings.theme === "light" && (
                      <Check className="h-3 w-3 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={themeDarkRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-24",
                  settings.theme === "dark" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleThemeChange("dark")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-1 h-20">
                  <Moon className="h-3 w-3" />
                  <span className="text-xs font-medium">Dark</span>
                  <div className="h-3 w-3 flex items-center justify-center">
                    {settings.theme === "dark" && (
                      <Check className="h-3 w-3 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={themeSystemRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-24",
                  settings.theme === "system" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleThemeChange("system")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-1 h-20">
                  <Monitor className="h-3 w-3" />
                  <span className="text-xs font-medium">System</span>
                  <div className="h-3 w-3 flex items-center justify-center">
                    {settings.theme === "system" && (
                      <Check className="h-3 w-3 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Font Family */}
          <div className="space-y-3">
            <Label>Font Family</Label>
            <div className="flex flex-row gap-3 overflow-x-auto p-1">
              <Card
                ref={fontFamilyMerriweatherRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-28",
                  settings.fontFamily === "merriweather" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontFamilyChange("merriweather")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-32">
                  <div className="text-2xl font-serif">Aa</div>
                  <span className="text-xs text-center">Merriweather</span>
                  <span className="text-xs text-muted-foreground">Serif</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.fontFamily === "merriweather" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={fontFamilyInterRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-28",
                  settings.fontFamily === "inter" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontFamilyChange("inter")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-32">
                  <div className="text-2xl font-sans">Aa</div>
                  <span className="text-xs text-center">Inter</span>
                  <span className="text-xs text-muted-foreground">
                    Sans Serif
                  </span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.fontFamily === "inter" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={fontFamilyMonospaceRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-28",
                  settings.fontFamily === "monospace" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontFamilyChange("monospace")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-32">
                  <div className="text-2xl font-mono">Aa</div>
                  <span className="text-xs text-center">Monospace</span>
                  <span className="text-xs text-muted-foreground">Fixed</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.fontFamily === "monospace" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Font Size */}
          <div className="space-y-3">
            <Label>Font Size</Label>
            <div className="flex flex-row gap-3 overflow-x-auto p-1">
              <Card
                ref={fontSizeSmallRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-24",
                  settings.fontSize === "small" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontSizeChange("small")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-24">
                  <div className="text-sm">Aa</div>
                  <span className="text-xs font-medium">Small</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.fontSize === "small" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={fontSizeMediumRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-24",
                  settings.fontSize === "medium" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontSizeChange("medium")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-24">
                  <div className="text-base">Aa</div>
                  <span className="text-xs font-medium">Medium</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.fontSize === "medium" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={fontSizeLargeRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-24",
                  settings.fontSize === "large" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontSizeChange("large")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-24">
                  <div className="text-lg">Aa</div>
                  <span className="text-xs font-medium">Large</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.fontSize === "large" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={fontSizeXlargeRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-24",
                  settings.fontSize === "xlarge" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontSizeChange("xlarge")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-24">
                  <div className="text-xl">Aa</div>
                  <span className="text-xs font-medium">Extra Large</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.fontSize === "xlarge" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Padding */}
          <div className="space-y-3">
            <Label>Content Padding</Label>
            <div className="flex flex-row gap-3 overflow-x-auto p-1">
              <Card
                ref={paddingCompactRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-28",
                  settings.contentPadding === "compact" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handlePaddingChange("compact")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-36">
                  <div className="w-full h-16 rounded border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                    <div className="w-3/4 h-8 bg-muted rounded"></div>
                  </div>
                  <span className="text-xs font-medium">Compact</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.contentPadding === "compact" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={paddingComfortableRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-28",
                  settings.contentPadding === "comfortable" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handlePaddingChange("comfortable")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-36">
                  <div className="w-full h-16 rounded border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                    <div className="w-2/3 h-8 bg-muted rounded"></div>
                  </div>
                  <span className="text-xs font-medium">Comfortable</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.contentPadding === "comfortable" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={paddingSpaciousRef}
                className={cn(
                  "cursor-pointer transition-all hover:border-primary flex-shrink-0 w-28",
                  settings.contentPadding === "spacious" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handlePaddingChange("spacious")}
              >
                <CardContent className="p-4 flex flex-col items-center gap-2 h-36">
                  <div className="w-full h-16 rounded border-2 border-dashed border-muted-foreground/30 flex items-center justify-center">
                    <div className="w-1/2 h-8 bg-muted rounded"></div>
                  </div>
                  <span className="text-xs font-medium">Spacious</span>
                  <div className="h-4 w-4 flex items-center justify-center">
                    {settings.contentPadding === "spacious" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
