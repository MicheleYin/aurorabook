import { Palette } from "lucide-react";

import type { UITheme } from "../types/ui";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

type SettingsPanelProps = {
  theme: UITheme;
  onThemeChange: (theme: UITheme) => void;
};

export function SettingsPanel({ theme, onThemeChange }: SettingsPanelProps) {
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="flex items-start gap-3">
        <div className="rounded-full border border-border p-2 text-primary">
          <Palette className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Control how the reader looks and feels.
          </p>
        </div>
      </div>

      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="text-xl">Appearance</CardTitle>
          <CardDescription>Choose how the app theme should behave.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Theme</p>
              <p className="text-sm text-muted-foreground">
                Switch between light, dark, or follow your system setting.
              </p>
            </div>
            <ThemeSwitcher value={theme} onChange={onThemeChange} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


