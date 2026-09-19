import { Check } from "lucide-react";
import { memo, useEffect, useState } from "react";

import { anim } from "../lib/animations";
import { useTranslation } from "../lib/i18n";
import {
  getPreferredDarkTheme,
  getPreferredLightTheme,
  isDarkTheme,
  isLightTheme,
  rememberPreferredTheme,
  resolveColorTheme,
  themeClassNames,
} from "../lib/theme";
import { cn } from "../lib/utils";
import type { ColorTheme, DarkTheme, LightTheme, UITheme } from "../types/ui";
import { Switch } from "./ui/switch";
interface ThemeSwitcherProps {
  value: UITheme;
  onChange: (theme: UITheme) => void;
}const LIGHT_VARIANTS: Array<{
  id: LightTheme;
  labelKey: string;
  preview: string;
}> = [
  {
    id: "light",
    labelKey: "reader.theme_light",
    preview: "bg-[#f5f5f5] text-[#2a3d4d]",
  },
  {
    id: "cream",
    labelKey: "reader.theme_cream",
    preview: "bg-[#f7f1e3] text-[#3a2f24]",
  },
  {
    id: "sunset",
    labelKey: "reader.theme_sunset",
    preview: "bg-[#f8e9d8] text-[#4a2a23]",
  },
  {
    id: "rose",
    labelKey: "reader.theme_rose",
    preview: "bg-[#f9e9ee] text-[#4e303c]",
  },
  {
    id: "forest",
    labelKey: "reader.theme_forest",
    preview: "bg-[#35483f] text-[#e8eadf]",
  },
];

const DARK_VARIANTS: Array<{
  id: DarkTheme;
  labelKey: string;
  preview: string;
}> = [
  {
    id: "dark",
    labelKey: "reader.theme_dark",
    preview: "bg-[#14171c] text-[#f1f5f9]",
  },
  {
    id: "pitch",
    labelKey: "reader.theme_pitch",
    preview: "bg-black text-[#f5f5f5]",
  },
  {
    id: "plum",
    labelKey: "reader.theme_plum",
    preview: "bg-[#1b1319] text-[#f5eef3]",
  },
  {
    id: "dark_violet",
    labelKey: "reader.theme_dark_violet",
    preview: "bg-[#15131f] text-[#f1eff8]",
  },
  {
    id: "dark_green",
    labelKey: "reader.theme_dark_green",
    preview: "bg-[#11231a] text-[#eaf2e9]",
  },
];

function ThemeSwitcherComponent({
  value,
  onChange,
}: Readonly<ThemeSwitcherProps>) {
  const { t } = useTranslation();
  const autoEnabled = value === "system";

  const [preferredLight, setPreferredLight] = useState<LightTheme>(() =>
    isLightTheme(value) ? value : getPreferredLightTheme()
  );
  const [preferredDark, setPreferredDark] = useState<DarkTheme>(() =>
    isDarkTheme(value) ? value : getPreferredDarkTheme()
  );

  useEffect(() => {
    if (isLightTheme(value)) setPreferredLight(value);
    if (isDarkTheme(value)) setPreferredDark(value);
  }, [value]);

  // Re-resolve when OS appearance changes; SettingsContext only updates DOM classes.
  const [systemTheme, setSystemTheme] = useState<ColorTheme>(() =>
    resolveColorTheme("system")
  );

  useEffect(() => {
    if (!autoEnabled) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      setSystemTheme(resolveColorTheme("system"));
    };

    syncSystemTheme();

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", syncSystemTheme);
      return () => mediaQuery.removeEventListener("change", syncSystemTheme);
    }

    mediaQuery.addListener(syncSystemTheme);
    return () => mediaQuery.removeListener(syncSystemTheme);
  }, [autoEnabled, preferredLight, preferredDark]);

  const activeTheme = autoEnabled ? systemTheme : (value as ColorTheme);
  const lightActive = isLightTheme(activeTheme);
  const darkActive = isDarkTheme(activeTheme);

  const lightPreview =
    LIGHT_VARIANTS.find((v) => v.id === preferredLight) ?? LIGHT_VARIANTS[0];
  const darkPreview =
    DARK_VARIANTS.find((v) => v.id === preferredDark) ?? DARK_VARIANTS[0];

  const forceTheme = (theme: ColorTheme) => {
    rememberPreferredTheme(theme);
    if (isLightTheme(theme)) setPreferredLight(theme);
    else setPreferredDark(theme);
    onChange(theme);
  };

  const chooseVariant = (theme: ColorTheme) => {
    rememberPreferredTheme(theme);
    if (isLightTheme(theme)) setPreferredLight(theme);
    else setPreferredDark(theme);

    if (autoEnabled) {
      // Stay on auto; re-apply so the new preferred look takes effect now.
      onChange("system");
      return;
    }
    onChange(theme);
  };

  const activeLabel = t(
    lightActive
      ? `reader.theme_${preferredLight}`
      : `reader.theme_${preferredDark}`
  );

  return (
    <div className="w-full max-w-sm space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <ThemeSideCard
          label={t("reader.theme_light")}
          previewClass={lightPreview.preview}
          selected={!autoEnabled && lightActive}
          following={autoEnabled && lightActive}
          onSelect={() => forceTheme(preferredLight)}
          variants={LIGHT_VARIANTS.map((variant) => ({
            id: variant.id,
            label: t(variant.labelKey),
            theme: variant.id,
            active: preferredLight === variant.id,
            onSelect: () => chooseVariant(variant.id),
          }))}
        />
        <ThemeSideCard
          label={t("reader.theme_dark")}
          previewClass={darkPreview.preview}
          selected={!autoEnabled && darkActive}
          following={autoEnabled && darkActive}
          onSelect={() => forceTheme(preferredDark)}
          variants={DARK_VARIANTS.map((variant) => ({
            id: variant.id,
            label: t(variant.labelKey),
            theme: variant.id,
            active: preferredDark === variant.id,
            onSelect: () => chooseVariant(variant.id),
          }))}
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("reader.theme_auto")}</p>
          <p className="text-xs text-muted-foreground truncate">
            {autoEnabled
              ? t("reader.theme_auto_on", { theme: activeLabel })
              : t("reader.theme_auto_off")}
          </p>
        </div>
        <Switch
          checked={autoEnabled}
          onCheckedChange={(checked) => {
            if (checked) onChange("system");
            else onChange(activeTheme);
          }}
          aria-label={t("reader.theme_auto")}
        />
      </div>
    </div>
  );
}

/** Semi-transparent highlight composited over the theme background,
 * matching how word highlights appear on reader pages. */
const highlightPreviewStyle = {
  backgroundImage:
    "linear-gradient(hsl(var(--audio-highlight) / var(--audio-highlight-word-alpha)), hsl(var(--audio-highlight) / var(--audio-highlight-word-alpha)))",
  backgroundColor: "hsl(var(--background))",
} as const;

interface ThemeSideCardProps {
  label: string;
  previewClass: string;
  selected: boolean;
  following: boolean;
  onSelect: () => void;
  variants: Array<{
    id: string;
    label: string;
    theme: string;
    active: boolean;
    onSelect: () => void;
  }>;
}

function ThemeSideCard({
  label,
  previewClass,
  selected,
  following,
  onSelect,
  variants,
}: Readonly<ThemeSideCardProps>) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border-2 transition-all",
        anim("medium", "all"),
        selected && "border-primary ring-2 ring-primary/30",
        following && "border-primary/70 ring-1 ring-primary/20",
        !selected && !following && "border-border"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected || following}
        aria-label={t("app.switch_theme", { theme: label })}
        className={cn(
          "relative flex h-24 w-full flex-col items-start justify-between gap-1 p-3 text-left",
          previewClass
        )}
      >
        <span className="text-xs font-semibold tracking-wide uppercase opacity-80">
          {label}
        </span>
        {(selected || following) && (
          <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="size-3" aria-hidden="true" />
          </span>
        )}
        <span className="text-sm font-medium">
          {variants.find((v) => v.active)?.label ?? label}
        </span>
        <span
          className={cn(
            "mt-auto h-1.5 w-14 rounded-full",
            themeClassNames(variants.find((v) => v.active)?.theme)
          )}
          style={highlightPreviewStyle}
          aria-hidden="true"
        />
      </button>
      <div className="flex items-center gap-1.5 border-t border-border/60 bg-background/80 px-2 py-1.5">
        {variants.map((variant) => (
          <button
            key={variant.id}
            type="button"
            title={variant.label}
            aria-label={variant.label}
            aria-pressed={variant.active}
            onClick={(event) => {
              event.stopPropagation();
              variant.onSelect();
            }}
            className={cn(
              "flex size-6 items-center justify-center rounded-full transition-transform",
              anim("fast", "transform"),
              variant.active
                ? "ring-2 ring-primary scale-105"
                : "ring-1 ring-border/60 hover:ring-border"
            )}
          >
            <span
              className={cn(
                "size-4 rounded-full border isolate",
                themeClassNames(variant.theme)
              )}
              style={{
                ...highlightPreviewStyle,
                borderColor: "hsl(var(--border))",
              }}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
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
