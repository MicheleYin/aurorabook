import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Pause, Play } from "lucide-react";

import { useSettingsContext } from "@/context/SettingsContext";
import { useTranslation } from "../../lib/i18n";

import type { UITheme } from "../../types/ui";
import { KOKORO_VOICE_GROUPS } from "../../constants/kokoro";
import { logger } from "../../lib/logger";
import { ThemeSwitcher } from "../ThemeSwitcher";
import { LanguageSelect } from "./LanguageSelect";
import { TtsLanguageSelect } from "./TtsLanguageSelect";
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
  const { t } = useTranslation();
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string>(t("common.loading"));
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
  }, [t]);

  const handleThemeChange = useCallback(
    async (newTheme: UITheme) => {
      applyTheme(newTheme);
      await saveSettings({ theme: newTheme });
    },
    [applyTheme, saveSettings]
  );

  const handlePlaySample = useCallback(
    async (voiceId: string, sampleUrl: string) => {
      if (playingVoiceId === voiceId && audioRef.current) {
        audioRef.current.pause();
        setPlayingVoiceId(null);
        return;
      }

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const audioData = await invoke<number[]>("read_resource_file", {
          resourcePath: sampleUrl,
        });

        const audioBytes = new Uint8Array(audioData);
        const blob = new Blob([audioBytes], { type: "audio/mpeg" });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;

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
          <p className="text-sm text-muted-foreground">{t("app.loading_settings")}</p>
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm text-destructive">{t("app.failed_load_settings")}</p>
          <button
            onClick={reloadSettings}
            className="text-sm text-primary hover:underline"
          >
            {t("app.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="p-6 space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{t("app.settings")}</h1>
          <p className="text-muted-foreground">
            {t("app.manage_preferences")}
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <Separator />

        <div className="space-y-6">
          {/* Language & Appearance Section */}
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.application")}</CardTitle>
              <CardDescription>
                {t("app.customize_experience")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <LanguageSelect />
              <Separator />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1">
                  <p className="font-medium">{t("app.theme")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.theme_description")}
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
              <CardTitle>{t("settings.tts_language")}</CardTitle>
              <CardDescription>
                {t("settings.voice_description")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <TtsLanguageSelect />
              <Separator />
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium mb-2">{t("settings.voice")}</p>
                  <Select
                    value={settings?.ttsVoiceId || "af_heart"}
                    onValueChange={handleVoiceChange}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {selectedVoice
                          ? `${selectedVoice.name} (${selectedVoice.gender})`
                          : t("common.select_voice")}
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
                        <div className="text-xs text-muted-foreground min-w-0 truncate">
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
              <CardTitle>{t("settings.general")}</CardTitle>
              <CardDescription>{t("settings.general_description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col gap-2">
                <p className="font-medium">{t("settings.app_version")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("app.version")} {appVersion}
                </p>
              </div>
              {isSaving && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                  {t("app.saving")}
                </div>
              )}
            </CardContent>
          </Card>

          {/* FAQ Section */}
          <Card>
            <CardHeader>
              <CardTitle>{t("settings.faq")}</CardTitle>
              <CardDescription>
                {t("settings.faq_description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="how-it-works">
                  <AccordionTrigger>{t("faq.how_works.q")}</AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      {t("faq.how_works.a")}
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="why-slow">
                  <AccordionTrigger>{t("faq.why_slow.q")}</AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      {t("faq.why_slow.a")}
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="wait-for-completion">
                  <AccordionTrigger>
                    {t("faq.wait_completion.q")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      {t("faq.wait_completion.a")}
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="can-stop">
                  <AccordionTrigger>
                    {t("faq.can_stop.q")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      {t("faq.can_stop.a")}
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="audio-sync">
                  <AccordionTrigger>
                    {t("faq.audio_sync.q")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      {t("faq.audio_sync.a")}
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="multiple-books">
                  <AccordionTrigger>
                    {t("faq.multiple_books.q")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      {t("faq.multiple_books.a")}
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="voice-selection">
                  <AccordionTrigger>
                    {t("faq.voice_selection.q")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      {t("faq.voice_selection.a")}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
