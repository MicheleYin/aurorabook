import { useEffect, useRef, useState, useMemo } from "react";
import { Check, Play, Pause, Volume2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
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
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { anim } from "../lib/animations";

type SettingsPanelProps = {
  settings: AppSettings;
  onSettingsChange: (update: Partial<AppSettings>) => void;
};

export function SettingsPanel({ settings, onSettingsChange }: SettingsPanelProps) {
  const [showSaved, setShowSaved] = useState(false);
  const [previousSettings, setPreviousSettings] = useState(settings);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

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

  // Find the currently selected voice
  const selectedVoice = useMemo(() => {
    const allVoices = KOKORO_VOICE_GROUPS.flatMap(group => group.voices);
    return allVoices.find(voice => voice.id === settings.ttsVoiceId);
  }, [settings.ttsVoiceId]);

  const handlePlaySample = async (voiceId: string, sampleUrl: string) => {
    
    // If clicking the same voice that's playing, pause it
    if (playingVoiceId === voiceId && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlayingVoiceId(null);
      return;
    }
    
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    
    // Clean up previous blob URL
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    
    try {
      // Load resource file from bundle (sampleUrl is like "voice-samples/af_heart.mp3")
      const fileData = await invoke<number[]>("read_resource_file", {
        resourcePath: sampleUrl,
      });
      
      // Convert number array to Uint8Array
      const uint8Array = new Uint8Array(fileData);
      
      // Create blob URL
      const blob = new Blob([uint8Array], { type: "audio/mpeg" });
      const blobUrl = URL.createObjectURL(blob);
      blobUrlRef.current = blobUrl;
      
      // Create new audio element if needed
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.addEventListener("ended", () => {
          setPlayingVoiceId(null);
        });
        audioRef.current.addEventListener("error", () => {
          console.error("Failed to play voice sample:", sampleUrl);
          setPlayingVoiceId(null);
        });
      }
      
      // Play the new sample
      audioRef.current.src = blobUrl;
      audioRef.current.play().catch((error) => {
        console.error("Error playing audio:", error);
        setPlayingVoiceId(null);
      });
      setPlayingVoiceId(voiceId);
    } catch (error) {
      console.error("Failed to load voice sample:", error);
      setPlayingVoiceId(null);
    }
  };

  // Cleanup audio and blob URLs on unmount
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
                            {voice.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Voice Preview Component */}
            {selectedVoice && (
              <div className="rounded-lg border bg-gradient-to-br from-muted/50 to-muted/30 p-4 transition-all duration-300">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Volume2 className="h-4 w-4 text-muted-foreground" />
                      <h4 className="font-semibold text-sm">Voice Preview</h4>
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-base">{selectedVoice.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="px-2 py-0.5 rounded-full bg-background/60 border border-border/40">
                          {selectedVoice.languageTag.toUpperCase()}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-background/60 border border-border/40">
                          {selectedVoice.gender}
                        </span>
                        <span className="text-muted-foreground/80">{selectedVoice.summary}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="lg"
                    className={cn(
                      "shrink-0 gap-2 min-w-[140px] justify-center"
                    )}
                    onClick={() => handlePlaySample(selectedVoice.id, selectedVoice.sampleUrl)}
                    aria-label={`Play sample for ${selectedVoice.name}`}
                  >
                    {playingVoiceId === selectedVoice.id ? (
                      <>
                        <Pause className="h-4 w-4" />
                        <span>Pause</span>
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" />
                        <span>Play</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

