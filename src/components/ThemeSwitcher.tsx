import { memo, useEffect, useState } from "react";
import { Check } from "lucide-react";

import type { ColorTheme, DarkTheme, LightTheme, UITheme } from "../types/ui";
import { anim } from "../lib/animations";
import {
  getPreferredDarkTheme,
  getPreferredLightTheme,
  isDarkTheme,
  isLightTheme,
  rememberPreferredTheme,
  resolveColorTheme,
} from "../lib/theme";
import { cn } from "../lib/utils";
import { useTranslation } from "../lib/i18n";

interface ThemeSwitcherProps {
  value: UITheme;
  onChange: (theme: UITheme) => void;
}

const LIGHT_VARIANTS: Array<{
  id: LightTheme;
  labelKey: string;
  preview: string;
  chip: string;
}> = [
  {
    id: "light",
    labelKey: "reader.theme_light",
    preview: "bg-[#f5f5f5] text-[#2a3d4d]",
    chip: "bg-[#f7f7f7] border border-black/15",
  },
  {
    id: "cream",
    labelKey: "reader.theme_cream",
    preview: "bg-[#f7f1e3] text-[#3a2f24]",
    chip: "bg-[#f7f1e3] border border-black/15",
  },
];

const DARK_VARIANTS: Array<{
  id: DarkTheme;
  labelKey: string;
  preview: string;
  chip: string;
}> = [
  {
    id: "dark",
    labelKey: "reader.theme_dark",
    preview: "bg-[#14171c] text-[#f1f5f9]",
    chip: "bg-[#14171c] border border-white/20",
  },
  {
    id: "pitch",
    labelKey: "reader.theme_pitch",
    preview: "bg-black text-[#f5f5f5]",
    chip: "bg-black border border-white/20",
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

  const activeTheme = autoEnabled
    ? resolveColorTheme("system")
    : (value as ColorTheme);
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

  const handleAutoToggle = () => {
    if (autoEnabled) {
      onChange(activeTheme);
      return;
    }
    onChange("system");
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
            chip: variant.chip,
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
            chip: variant.chip,
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
        <button
          type="button"
          role="switch"
          aria-checked={autoEnabled}
          aria-label={t("reader.theme_auto")}
          onClick={handleAutoToggle}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full border transition-colors",
            anim("medium", "colors"),
            autoEnabled
              ? "border-primary bg-primary"
              : "border-border bg-muted"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform",
              anim("medium", "transform"),
              autoEnabled && "translate-x-5"
            )}
          />
        </button>
      </div>
    </div>
  );
}

interface ThemeSideCardProps {
  label: string;
  previewClass: string;
  selected: boolean;
  following: boolean;
  onSelect: () => void;
  variants: Array<{
    id: string;
    label: string;
    chip: string;
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
          "relative flex h-20 w-full flex-col items-start justify-between p-3 text-left",
          previewClass
        )}
      >
        <span className="text-xs font-semibold tracking-wide uppercase opacity-80">
          {label}
        </span>
        {(selected || following) && (
          <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
        <span className="text-sm font-medium">
          {variants.find((v) => v.active)?.label ?? label}
        </span>
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
              "flex h-7 w-7 items-center justify-center rounded-full transition-transform",
              anim("fast", "transform"),
              variant.active
                ? "ring-2 ring-primary scale-105"
                : "opacity-70 hover:opacity-100"
            )}
          >
            <span
              className={cn("h-4 w-4 rounded-full", variant.chip)}
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
