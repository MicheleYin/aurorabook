import { KOKORO_VOICE_GROUPS } from "../constants/kokoro";
import { useKokoroPrefetch } from "../hooks/useKokoroPrefetch";
import type { AppSettings } from "../types/settings";
import type { UITheme } from "../types/ui";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

type SettingsPanelProps = {
  settings: AppSettings;
  onSettingsChange: (update: Partial<AppSettings>) => void;
};

export function SettingsPanel({ settings, onSettingsChange }: SettingsPanelProps) {
  const { modelState, voiceState, prefetchModel, prefetchVoices } = useKokoroPrefetch();
  const handleThemeChange = (theme: UITheme) => onSettingsChange({ theme });

  return (
    <div className="flex h-full flex-col gap-6">
      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="text-xl">Preferences</CardTitle>
          <CardDescription>Control the Reader theme and Kokoro settings from one place.</CardDescription>
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

            <div className="space-y-4">
              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex-1">
                  <p className="font-medium">Kokoro model</p>
                  <p className="text-sm text-muted-foreground">
                    Cache the base Kokoro weights locally so narration can start instantly.
                  </p>
                  {modelState.message && (
                    <p
                      className={`text-xs ${modelState.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {modelState.message}
                    </p>
                  )}
                </div>
                <Button
                  onClick={prefetchModel}
                  disabled={modelState.status === "running"}
                  className="w-full sm:w-auto"
                >
                  {modelState.status === "running" ? "Downloading…" : "Cache model"}
                </Button>
              </div>

              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                <div className="flex-1">
                  <p className="font-medium">Voice pack</p>
                  <p className="text-sm text-muted-foreground">
                    Download every Kokoro voice profile to keep previews available offline.
                  </p>
                  {voiceState.message && (
                    <p
                      className={`text-xs ${voiceState.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {voiceState.message}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={prefetchVoices}
                  disabled={voiceState.status === "running"}
                  className="w-full sm:w-auto"
                >
                  {voiceState.status === "running" ? "Downloading…" : "Cache voices"}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
              <div className="flex-1">
                <p className="font-medium">Default voice</p>
                <p className="text-sm text-muted-foreground">
                  Select the Kokoro voice used for previews and on-device narration.
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

