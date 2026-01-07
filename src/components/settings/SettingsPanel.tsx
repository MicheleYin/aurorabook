import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Pause, Play } from "lucide-react";

import { useSettingsContext } from "@/context/SettingsContext";

import type { UITheme } from "../../types/ui";
import { KOKORO_VOICE_GROUPS } from "../../constants/kokoro";
import { logger } from "../../lib/logger";
import { ThemeSwitcher } from "../ThemeSwitcher";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";

export function Settings() {
  const {
    settings,
    isLoading,
    isSaving,
    error,
    saveSettings,
    reloadSettings,
    applyTheme,
  } = useSettingsContext();
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>("Loading...");
  // const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // Load app version from Tauri
  useEffect(() => {
    getVersion()
      .then((version) => setAppVersion(version))
      .catch((err) => {
        logger.error("Failed to get app version:", err);
        setAppVersion("Unknown");
      });
  }, []);

  const handleThemeChange = useCallback(
    async (newTheme: UITheme) => {
      applyTheme(newTheme);
      await saveSettings({ theme: newTheme });
    },
    [applyTheme, saveSettings]
  );

  const handlePlaySample = useCallback(
    async (voiceId: string, sampleUrl: string) => {
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
        const { invoke } = await import("@tauri-apps/api/core");
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
          logger.error("Failed to play audio sample");
          setPlayingVoiceId(null);
          audioRef.current = null;
          if (blobUrlRef.current) {
            URL.revokeObjectURL(blobUrlRef.current);
            blobUrlRef.current = null;
          }
        };

        await audio.play();
      } catch (err) {
        logger.error("Failed to load voice sample:", err);
        setPlayingVoiceId(null);
      }
    },
    [playingVoiceId]
  );

  const handleVoiceChange = useCallback(
    async (voiceId: string) => {
      await saveSettings({ ttsVoiceId: voiceId });
    },
    [saveSettings]
  );

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
  const allVoices = useMemo(
    () => KOKORO_VOICE_GROUPS.flatMap((group) => group.voices),
    []
  );
  const selectedVoice = useMemo(
    () => allVoices.find((voice) => voice.id === settings?.ttsVoiceId),
    [allVoices, settings?.ttsVoiceId]
  );

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
            onClick={reloadSettings}
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
      <div className="p-6 space-y-6">
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
                    value={(settings?.theme as UITheme) || "system"}
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
                Select and preview the default voice for text-to-speech
                conversion
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium mb-2">Default Voice</p>
                  <Select
                    value={settings?.ttsVoiceId || "af_heart"}
                    onValueChange={handleVoiceChange}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {selectedVoice
                          ? `${selectedVoice.name} (${selectedVoice.gender})`
                          : "Select a voice"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {KOKORO_VOICE_GROUPS.map((group) => (
                        <div key={group.label}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                            {group.label}
                          </div>
                          {group.voices.map((voice) => (
                            <SelectItem key={voice.id} value={voice.id}>
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
                        handlePlaySample(
                          selectedVoice.id,
                          selectedVoice.sampleUrl
                        )
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
              <CardDescription>General application settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2">
                <p className="font-medium">Application Version</p>
                <p className="text-sm text-muted-foreground">
                  Version {appVersion}
                </p>
              </div>
              {/* <div className="flex flex-col gap-2">
                <p className="font-medium">Debug Tools</p>
                <Button
                  variant="outline"
                  onClick={() => setIsLogViewerOpen(true)}
                  className="w-full sm:w-auto"
                >
                  <Terminal className="mr-2 h-4 w-4" />
                  Open Log Viewer
                </Button>
                <p className="text-sm text-muted-foreground">
                  View frontend and backend logs for debugging
                </p>
              </div> */}
              {isSaving && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                  Saving...
                </div>
              )}
            </CardContent>
          </Card>

          {/* FAQ Section */}
          <Card>
            <CardHeader>
              <CardTitle>Frequently Asked Questions</CardTitle>
              <CardDescription>
                Common questions about the application
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="how-it-works">
                  <AccordionTrigger>How does the app work?</AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      The app uses Kokoro and eSpeak, powerful text-to-speech
                      (TTS) technologies, to convert your EPUB books into
                      high-quality audio. Kokoro provides natural-sounding
                      voices, while eSpeak offers additional language support
                      and pronunciation accuracy.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="why-slow">
                  <AccordionTrigger>Why is it so slow?</AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      Text-to-speech conversion is computationally expensive.
                      Generating high-quality audio from text requires
                      significant processing power, especially for longer books.
                      The app processes each chapter sequentially to ensure
                      quality and manage system resources efficiently.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="wait-for-completion">
                  <AccordionTrigger>
                    Do I have to wait until everything is done?
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      No! You can start listening as soon as the first chapter
                      completes. The app allows you to begin playback while
                      conversion continues in the background. You&apos;ll be
                      able to listen to completed chapters while others are
                      still being processed.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="can-stop">
                  <AccordionTrigger>
                    Can I stop the conversion?
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      Yes, you can stop the conversion at any time and resume
                      later. The app saves your progress, so when you restart,
                      it will continue from where you left off. Any chapters
                      that were already converted will remain available for
                      playback.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="audio-sync">
                  <AccordionTrigger>
                    What is audio-text synchronization?
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      Audio-text synchronization automatically highlights the
                      text being read as the audio plays. When enabled, the
                      reader will scroll to and highlight the current text
                      segment, making it easy to follow along. You can toggle
                      this feature on or off using the sync button in the audio
                      player.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="multiple-books">
                  <AccordionTrigger>
                    Can I convert multiple books at once?
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      Currently, the app processes one book at a time to ensure
                      optimal performance and resource management. You can queue
                      books by starting conversions sequentially, and each will
                      process after the previous one completes.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="voice-selection">
                  <AccordionTrigger>
                    Can I change the voice for a book?
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      Voice selection is set when you start the conversion
                      process. If you want to use a different voice, you&apos;ll
                      need to delete the existing audio tracks and start a new
                      conversion with your preferred voice. The default voice
                      can be changed in settings.
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </div>
      {/* <LogViewer isOpen={isLogViewerOpen} onOpenChange={setIsLogViewerOpen} /> */}
    </div>
  );
}
