
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


