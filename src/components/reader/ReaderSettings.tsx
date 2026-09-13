import { useEffect, useRef } from "react";
import { Check } from "lucide-react";

import { useTranslation } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import type { UITheme } from "../../types/ui";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { Card, CardContent } from "../ui/card";
import {
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Label } from "../ui/label";
import { Slider } from "../ui/slider";

export interface ReaderSettings {
  theme: string;
  fontFamily: string;
  fontSize: string;
  contentPadding: string;
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
  const { t } = useTranslation();
  const fontFamilyMerriweatherRef = useRef<HTMLDivElement>(null);
  const fontFamilyInterRef = useRef<HTMLDivElement>(null);
  const fontFamilyMonospaceRef = useRef<HTMLDivElement>(null);

  const handleThemeChange = (theme: UITheme) => {
    onSettingsChange({ ...settings, theme });
  };

  const handleFontFamilyChange = (fontFamily: string) => {
    onSettingsChange({ ...settings, fontFamily });
  };

  const handleFontSizeChange = ([fontSize]: number[]) => {
    onSettingsChange({ ...settings, fontSize: String(fontSize) });
  };

  const handlePaddingChange = ([contentPadding]: number[]) => {
    onSettingsChange({ ...settings, contentPadding: String(contentPadding) });
  };

  const fontSizeValue = Number(settings.fontSize) || 16;
  const contentPaddingValue = Number(settings.contentPadding) || 24;

  useEffect(() => {
    if (!isOpen) return;

    const scrollToElement = (ref: React.RefObject<HTMLDivElement | null>) => {
      ref.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    };

    const fontFamilyRefs: Record<
      string,
      React.RefObject<HTMLDivElement | null>
    > = {
      merriweather: fontFamilyMerriweatherRef,
      inter: fontFamilyInterRef,
      monospace: fontFamilyMonospaceRef,
    };

    const timeoutId = setTimeout(() => {
      scrollToElement(fontFamilyRefs[settings.fontFamily]);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [isOpen, settings.fontFamily]);

  return (
    <Drawer open={isOpen} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[80vh] flex flex-col">
        <DrawerHandle />
        <DrawerHeader className="pb-4">
          <DrawerTitle>{t("reader.settings")}</DrawerTitle>
        </DrawerHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          <div className="space-y-2">
            <Label className="text-sm">{t("reader.theme")}</Label>
            <ThemeSwitcher
              value={(settings.theme as UITheme) || "system"}
              onChange={handleThemeChange}
            />
          </div>

          <div className="space-y-3">
            <Label>{t("reader.font_family")}</Label>
            <div className="flex flex-row gap-3 overflow-x-auto p-1">
              <Card
                ref={fontFamilyMerriweatherRef}
                className={cn(
                  "w-28 flex-shrink-0 cursor-pointer transition-all hover:border-primary",
                  settings.fontFamily === "merriweather" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontFamilyChange("merriweather")}
              >
                <CardContent className="flex h-32 flex-col items-center gap-2 p-4">
                  <div className="text-2xl font-serif">Aa</div>
                  <span className="text-center text-xs">Merriweather</span>
                  <span className="text-xs text-muted-foreground">
                    {t("reader.font_serif")}
                  </span>
                  <div className="flex h-4 w-4 items-center justify-center">
                    {settings.fontFamily === "merriweather" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={fontFamilyInterRef}
                className={cn(
                  "w-28 flex-shrink-0 cursor-pointer transition-all hover:border-primary",
                  settings.fontFamily === "inter" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontFamilyChange("inter")}
              >
                <CardContent className="flex h-32 flex-col items-center gap-2 p-4">
                  <div className="text-2xl font-sans">Aa</div>
                  <span className="text-center text-xs">Inter</span>
                  <span className="text-xs text-muted-foreground">
                    {t("reader.font_sans")}
                  </span>
                  <div className="flex h-4 w-4 items-center justify-center">
                    {settings.fontFamily === "inter" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card
                ref={fontFamilyMonospaceRef}
                className={cn(
                  "w-28 flex-shrink-0 cursor-pointer transition-all hover:border-primary",
                  settings.fontFamily === "monospace" &&
                    "border-primary ring-2 ring-primary"
                )}
                onClick={() => handleFontFamilyChange("monospace")}
              >
                <CardContent className="flex h-32 flex-col items-center gap-2 p-4">
                  <div className="text-2xl font-mono">Aa</div>
                  <span className="text-center text-xs">Monospace</span>
                  <span className="text-xs text-muted-foreground">
                    {t("reader.font_fixed")}
                  </span>
                  <div className="flex h-4 w-4 items-center justify-center">
                    {settings.fontFamily === "monospace" && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="space-y-3">
            <Label>{t("reader.font_size")}</Label>
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">{fontSizeValue}px</p>
                    <p className="text-xs text-muted-foreground">
                      {t("reader.font_size")}
                    </p>
                  </div>
                  <div
                    className="text-right leading-none"
                    style={{ fontSize: `${fontSizeValue}px` }}
                  >
                    Aa
                  </div>
                </div>
                <Slider
                  value={[fontSizeValue]}
                  min={12}
                  max={28}
                  step={1}
                  onValueChange={handleFontSizeChange}
                  aria-label={t("reader.font_size")}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>12px</span>
                  <span>28px</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <Label>{t("reader.padding")}</Label>
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">
                      {contentPaddingValue}px
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("reader.padding")}
                    </p>
                  </div>
                  <div className="w-24 rounded border-2 border-dashed border-muted-foreground/30 p-2">
                    <div
                      className="h-8 rounded bg-muted"
                      style={{
                        marginInline: `${Math.min(contentPaddingValue / 2, 24)}px`,
                      }}
                    />
                  </div>
                </div>
                <Slider
                  value={[contentPaddingValue]}
                  min={8}
                  max={64}
                  step={2}
                  onValueChange={handlePaddingChange}
                  aria-label={t("reader.padding")}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>8px</span>
                  <span>64px</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
