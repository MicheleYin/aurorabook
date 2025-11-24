import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { KOKORO_VOICE_GROUPS } from "../constants/kokoro";
import type { AppSettings } from "../types/settings";
import type { UITheme } from "../types/ui";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { cn } from "../lib/utils";
import { anim } from "../lib/animations";

type SettingsPanelProps = {
  settings: AppSettings;
  onSettingsChange: (update: Partial<AppSettings>) => void;
};

export function SettingsPanel({ settings, onSettingsChange }: SettingsPanelProps) {
  const [showSaved, setShowSaved] = useState(false);
  const [previousSettings, setPreviousSettings] = useState(settings);

  useEffect(() => {
    // Check if settings changed
    if (JSON.stringify(previousSettings) !== JSON.stringify(settings)) {
      setShowSaved(true);
      const timer = setTimeout(() => {
        setShowSaved(false);
      }, 2000); // Show for 2 seconds
      setPreviousSettings(settings);
      return () => clearTimeout(timer);
    }
  }, [settings, previousSettings]);

  const handleThemeChange = (theme: UITheme) => onSettingsChange({ theme });

  return (
    <div className="flex h-full flex-col gap-6">
      <Card className="flex-1">
        <CardHeader className="relative">
          <CardTitle className="text-xl">Preferences</CardTitle>
          <CardDescription>Control the Reader theme and voice settings from one place.</CardDescription>
          {/* Saved confirmation animation */}
          <div
            className={cn(
              "absolute right-4 top-4 flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm text-primary",
              "transition-all duration-300 ease-in-out",
              showSaved
                ? "opacity-100 translate-y-0 scale-100"
                : "opacity-0 translate-y-2 scale-95 pointer-events-none"
            )}
          >
            <Check className={cn("h-4 w-4", anim("normal", "all"), showSaved && "animate-in zoom-in-95")} />
            <span>Saved</span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="w-full flex flex-col gap-4 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Theme</p>
                <p className="text-sm text-muted-foreground">
                  Switch between light, dark, or follow your system setting.
                </p>
              </div>
              <div className="flex w-full justify-center sm:w-auto sm:justify-end">
                <ThemeSwitcher value={settings.theme} onChange={handleThemeChange} />
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="flex-1">
                <p className="font-medium">Default voice</p>
                <p className="text-sm text-muted-foreground">
                  Select the voice used for previews and on-device narration.
                </p>
              </div>
              <div className="sm:max-w-xs w-full">
                <Select
                  value={settings.ttsVoiceId}
                  onValueChange={(voiceId) =>
                    onSettingsChange({
                      ttsVoiceId: voiceId as AppSettings["ttsVoiceId"],
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {KOKORO_VOICE_GROUPS.map((group) => (
                      <SelectGroup key={group.label}>
                        <SelectLabel>{group.label}</SelectLabel>
                        {group.voices.map((voice) => (
                          <SelectItem key={voice.id} value={voice.id}>
                            <div className="flex flex-col">
                              <span className="font-medium">{voice.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {voice.languageTag.toUpperCase()} · {voice.gender} · {voice.summary}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

