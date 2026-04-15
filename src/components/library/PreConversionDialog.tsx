import { useState, useMemo } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Label } from "../ui/label";
import { KOKORO_VOICE_GROUPS, DEFAULT_KOKORO_VOICE_ID } from "../../constants/kokoro";
import { Play, X } from "lucide-react";

interface PreConversionDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (language: string, voiceId: string) => void;
  defaultLanguage?: string;
  defaultVoiceId?: string;
}

export function PreConversionDialog({
  isOpen,
  onOpenChange,
  onConfirm,
  defaultLanguage = "a",
  defaultVoiceId = DEFAULT_KOKORO_VOICE_ID,
}: PreConversionDialogProps) {
  const { t } = useTranslation();
  const [selectedLanguage, setSelectedLanguage] = useState(defaultLanguage);
  const [selectedVoice, setSelectedVoice] = useState(defaultVoiceId);

  const TTS_LANGUAGES = useMemo(() => [
    { id: "a", label: t("settings.tts_language_en_us"), code: "en-US" },
    { id: "b", label: t("settings.tts_language_en_gb"), code: "en-GB" },
    { id: "es", label: t("settings.tts_language_es"), code: "es-ES" },
    { id: "it", label: t("settings.tts_language_it"), code: "it-IT" },
    { id: "zh", label: t("settings.tts_language_zh"), code: "zh-CN" },
  ], [t]);

  // Filter voices based on selected language
  const availableVoices = useMemo(() => {
    const langCode = TTS_LANGUAGES.find(l => l.id === selectedLanguage)?.code;
    if (!langCode) return [];
    
    return KOKORO_VOICE_GROUPS.flatMap(group => group.voices)
      .filter(voice => voice.languageTag.startsWith(langCode.split('-')[0]));
  }, [selectedLanguage, TTS_LANGUAGES]);

  // Update selected voice when language changes if current voice is not available
  const handleLanguageChange = (langId: string) => {
    setSelectedLanguage(langId);
    const langCode = TTS_LANGUAGES.find(l => l.id === langId)?.code;
    const voices = KOKORO_VOICE_GROUPS.flatMap(group => group.voices)
      .filter(voice => voice.languageTag.startsWith(langCode?.split('-')[0] || ''));
    
    if (voices.length > 0) {
      setSelectedVoice(voices[0].id);
    }
  };

  const handleConfirm = () => {
    onConfirm(selectedLanguage, selectedVoice);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            {t("convert.title")}
          </DialogTitle>
          <DialogDescription>
            {t("convert.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="tts-language">{t("convert.language")}</Label>
            <Select value={selectedLanguage} onValueChange={handleLanguageChange}>
              <SelectTrigger id="tts-language">
                <SelectValue placeholder={t("common.select_language")} />
              </SelectTrigger>
              <SelectContent>
                {TTS_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.id} value={lang.id}>
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tts-voice">{t("convert.voice")}</Label>
            <Select value={selectedVoice} onValueChange={setSelectedVoice}>
              <SelectTrigger id="tts-voice">
                <SelectValue placeholder={t("common.select_voice")} />
              </SelectTrigger>
              <SelectContent>
                {availableVoices.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id}>
                    {voice.name} ({voice.gender === "Female" ? t("voice.female") : t("voice.male")})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="gap-2">
            <X className="h-4 w-4" />
            {t("convert.cancel")}
          </Button>
          <Button onClick={handleConfirm} className="gap-2">
            <Play className="h-4 w-4" />
            {t("convert.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
