import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Pause, Play } from "lucide-react";

import { useSettingsContext } from "@/context/SettingsContext";
import { useTranslation } from "../../lib/i18n";

import type { UITheme } from "../../types/ui";
import type { TtsSynthesisQuality } from "../../types/settings";
import { voiceMatchesTtsLanguage } from "../../constants/languages";
import { KOKORO_VOICE_GROUPS, voiceSamplePathsToTry } from "../../constants/kokoro";
import { SHOW_LOGS, SUPPORT_EMAIL } from "../../constants/support";
import { emailLogsReport, exportLogsToFile } from "../../lib/log-export";
import { logger } from "../../lib/logger";
import { LogViewer } from "../debug/LogViewer";
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
  const [logViewerOpen, setLogViewerOpen] = useState(false);
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
    async (voiceId: string, ttsLanguage: string) => {
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
        const paths = voiceSamplePathsToTry(voiceId, ttsLanguage);
        let audioData: number[] | null = null;
        let lastErr: unknown;
        for (const resourcePath of paths) {
          try {
            audioData = await invoke<number[]>("read_resource_file", {
              resourcePath,
            });
            break;
          } catch (e) {
            lastErr = e;
          }
        }
        if (!audioData) {
          throw lastErr ?? new Error("No voice sample found");
        }

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

  const handleExportLogs = useCallback(() => {
    void exportLogsToFile().catch((err) => {
      logger.error("Failed to export logs:", err);
    });
  }, []);

  const handleEmailSupport = useCallback(async () => {
    try {
      await emailLogsReport({
        to: SUPPORT_EMAIL,
        subject: t("faq.bug_report.email_subject"),
        body: t("faq.bug_report.email_body", { version: appVersion }),
      });
    } catch (err) {
      logger.error("Failed to open mail with logs:", err);
    }
  }, [appVersion, t]);

  const handleTtsQualityChange = useCallback(
    async (value: string) => {
      if (value === "fastest" || value === "balanced" || value === "quality") {
        await saveSettings({ ttsSynthesisQuality: value as TtsSynthesisQuality });
      }
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

  const filteredVoiceGroups = useMemo(() => {
    const ttsLanguage = settings?.ttsLanguage || "en";
    return KOKORO_VOICE_GROUPS.map((group) => ({
      ...group,
      voices: group.voices.filter((voice) =>
        voiceMatchesTtsLanguage(voice.languageTag, ttsLanguage)
      ),
    })).filter((group) => group.voices.length > 0);
  }, [settings?.ttsLanguage]);

  const allVoices = useMemo(
    () => filteredVoiceGroups.flatMap((group) => group.voices),
    [filteredVoiceGroups]
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
    <div className="flex h-full flex-col overflow-auto select-none">
      <div className="app-page-padding space-y-6">
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
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="space-y-1 flex-1 min-w-0">
                  <p className="font-medium">{t("settings.tts_quality")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.tts_quality_description")}
                  </p>
                </div>
                <Select
                  value={settings?.ttsSynthesisQuality ?? "balanced"}
                  onValueChange={handleTtsQualityChange}
                >
                  <SelectTrigger className="w-full sm:w-[260px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fastest">
                      {t("settings.tts_quality_fastest")}
                    </SelectItem>
                    <SelectItem value="balanced">
                      {t("settings.tts_quality_balanced")}
                    </SelectItem>
                    <SelectItem value="quality">
                      {t("settings.tts_quality_quality")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Separator />
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1">
                  <p className="font-medium mb-2">{t("settings.voice")}</p>
                  <Select
                    value={settings?.ttsVoiceId || "F1"}
                    onValueChange={handleVoiceChange}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {selectedVoice
                          ? `${t(selectedVoice.nameKey)} (${selectedVoice.gender === "Female" ? t("voice.female") : t("voice.male")})`
                          : t("common.select_voice")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {filteredVoiceGroups.map((group) => (
                        <div key={group.labelKey}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                            {t(group.labelKey)}
                          </div>
                          {group.voices.map((voice) => (
                            <SelectItem key={voice.id} value={voice.id}>
                              {t(voice.nameKey)} (
                              {voice.gender === "Female"
                                ? t("voice.female")
                                : t("voice.male")}
                              )
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
                          {selectedVoice.languageTag === "mul"
                            ? t("voice.multilingual")
                            : selectedVoice.languageTag}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {selectedVoice.gender === "Female"
                            ? t("voice.female")
                            : t("voice.male")}
                        </Badge>
                        <div className="text-xs text-muted-foreground min-w-0 truncate">
                          {t(selectedVoice.summaryKey)}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handlePlaySample(
                          selectedVoice.id,
                          settings?.ttsLanguage ?? "en"
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
              {SHOW_LOGS && (
                <div className="flex flex-col gap-2">
                  <p className="font-medium">{t("settings.logs")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.logs_description")}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    onClick={() => setLogViewerOpen(true)}
                  >
                    {t("settings.open_logs")}
                  </Button>
                </div>
              )}
              {isSaving && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                  {t("app.saving")}
                </div>
              )}
            </CardContent>
          </Card>

          <LogViewer isOpen={logViewerOpen} onOpenChange={setLogViewerOpen} />

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

                <AccordionItem value="foreground">
                  <AccordionTrigger>
                    {t("faq.foreground.q")}
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="text-sm text-muted-foreground">
                      {t("faq.foreground.a")}
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

                <AccordionItem value="bug-report">
                  <AccordionTrigger>{t("faq.bug_report.q")}</AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {t("faq.bug_report.a", { email: SUPPORT_EMAIL })}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExportLogs}
                      >
                        {t("faq.bug_report.export_logs")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLogViewerOpen(true)}
                      >
                        {t("faq.bug_report.view_logs")}
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                          void handleEmailSupport();
                        }}
                      >
                        {t("faq.bug_report.email")}
                      </Button>
                    </div>
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
