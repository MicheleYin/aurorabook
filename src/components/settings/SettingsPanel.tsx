import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Pause } from "lucide-react";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Separator } from "../ui/separator";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { KOKORO_VOICE_GROUPS } from "../../constants/kokoro";
import type { UITheme } from "../../types/ui";
import type { AppSettings } from "../../types/settings";
import { Badge } from "../ui/badge";

export function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Load settings from backend
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const appSettings = await invoke<AppSettings>("get_app_settings");
      setSettings(appSettings);
      
      // Apply theme from backend settings
      if (appSettings.theme) {
        applyTheme(appSettings.theme as UITheme);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
      setError(err instanceof Error ? err.message : "Failed to load settings");
      // Fallback to default settings
      setSettings({
        theme: "system",
        ttsVoiceId: "af_heart",
        autoScrollEnabled: true,
        audioPlaybackSpeed: 1.0,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async (updates: Partial<AppSettings>) => {
    if (!settings) return;

    try {
      setIsSaving(true);
      setError(null);
      const updatedSettings: AppSettings = { ...settings, ...updates };
      const savedSettings = await invoke<AppSettings>("update_app_settings", {
        settings: updatedSettings,
      });
      setSettings(savedSettings);
    } catch (err) {
      console.error("Failed to save settings:", err);
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const applyTheme = (newTheme: UITheme) => {
    const root = document.documentElement;
    
    if (newTheme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      root.classList.remove("light", "dark");
      root.classList.add(systemTheme);
    } else {
      root.classList.remove("light", "dark");
      root.classList.add(newTheme);
    }
  };

  const handleThemeChange = async (newTheme: UITheme) => {
    applyTheme(newTheme);
    await saveSettings({ theme: newTheme });
  };

  const handlePlaySample = async (voiceId: string, sampleUrl: string) => {
    // If clicking the same voice that's playing, pause it
    if (playingVoiceId === voiceId && audioRef.current) {
      audioRef.current.pause();
      setPlayingVoiceId(null);
      return;
    }

    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // Clean up previous blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    try {
      // Load the audio file from resources
      const audioData = await invoke<number[]>("read_resource_file", {
        resourcePath: sampleUrl,
      });

      // Convert Uint8Array to Blob
      const audioBytes = new Uint8Array(audioData);
      const blob = new Blob([audioBytes], { type: "audio/mpeg" });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;

      // Create and play audio
      const audio = new Audio(blobUrl);
      audioRef.current = audio;
      setPlayingVoiceId(voiceId);

      audio.onended = () => {
        setPlayingVoiceId(null);
        audioRef.current = null;
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };

      audio.onerror = () => {
        console.error("Failed to play audio sample");
        setPlayingVoiceId(null);
        audioRef.current = null;
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
          blobUrlRef.current = null;
        }
      };

      await audio.play();
    } catch (err) {
      console.error("Failed to load voice sample:", err);
      setPlayingVoiceId(null);
    }
  };

  const handleVoiceChange = async (voiceId: string) => {
    await saveSettings({ ttsVoiceId: voiceId });
  };

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Get all voices from groups
  const allVoices = KOKORO_VOICE_GROUPS.flatMap((group) => group.voices);
  const selectedVoice = allVoices.find((voice) => voice.id === settings?.ttsVoiceId);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-sm text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm text-destructive">Failed to load settings</p>
          <button
            onClick={loadSettings}
            className="text-sm text-primary hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="container mx-auto max-w-4xl p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Manage your application preferences and appearance
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <Separator />

        <div className="space-y-6">
          {/* Appearance Section */}
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Customize the look and feel of the application
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <p className="font-medium">Theme</p>
                  <p className="text-sm text-muted-foreground">
                    Choose between light, dark, or system theme
                  </p>
                </div>
                <div className="flex items-center justify-center sm:justify-end">
                  <ThemeSwitcher
                    value={(settings.theme as UITheme) || "system"}
                    onChange={handleThemeChange}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Voice Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Text-to-Speech Voice</CardTitle>
              <CardDescription>
                Select and preview the default voice for text-to-speech conversion
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium mb-2">Default Voice</p>
                  <Select
                    value={settings.ttsVoiceId || "af_heart"}
                    onValueChange={handleVoiceChange}

                  >
                    <SelectTrigger >
                      <SelectValue >
                        {selectedVoice
                          ? `${selectedVoice.name} (${selectedVoice.gender})`
                          : "Select a voice"}
                        </SelectValue>
                      </SelectTrigger>
                    <SelectContent >
                      {KOKORO_VOICE_GROUPS.map((group) => (
                        <div key={group.label} >
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                            {group.label}
                          </div>
                          {group.voices.map((voice) => (
                            <SelectItem key={voice.id} value={voice.id} >
                              {voice.name} ({voice.gender})
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedVoice && (
                  <div className="flex justify-between items-center gap-3 sm:flex-col sm:items-start sm:gap-2">
                    <div className="flex flex-col gap-1.5 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {selectedVoice.languageTag}
                      </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {selectedVoice.gender}
                        </Badge>
                        <div className="text-xs text-muted-foreground">
                          {selectedVoice.summary}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handlePlaySample(selectedVoice.id, selectedVoice.sampleUrl)
                      }
                      className="h-10 w-10 p-0 shrink-0"
                    >
                      {playingVoiceId === selectedVoice.id ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* General Settings */}
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>
                General application settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2">
                <p className="font-medium">Application Version</p>
                <p className="text-sm text-muted-foreground">
                  Version 1.0.0
                </p>
              </div>
              {isSaving && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                  Saving...
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

