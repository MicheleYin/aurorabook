import { useState, useMemo, useEffect } from "react";
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
import {
  AVAILABLE_LANGS,
  normalizeAppLanguage,
  voiceMatchesTtsLanguage,
} from "../../constants/languages";
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
  defaultLanguage,
  defaultVoiceId,
}: PreConversionDialogProps) {
  const { t } = useTranslation();

  const normalizedDefaultLang = useMemo(
    () => normalizeAppLanguage(defaultLanguage),
    [defaultLanguage]
  );

  const [selectedLanguage, setSelectedLanguage] = useState(normalizedDefaultLang);
  const [selectedVoice, setSelectedVoice] = useState(
    defaultVoiceId || DEFAULT_KOKORO_VOICE_ID
  );

  useEffect(() => {
    if (isOpen) {
      setSelectedLanguage(normalizedDefaultLang);
      setSelectedVoice(defaultVoiceId || DEFAULT_KOKORO_VOICE_ID);
    }
  }, [isOpen, normalizedDefaultLang, defaultVoiceId]);

  const availableVoices = useMemo(() => {
    return KOKORO_VOICE_GROUPS.flatMap((group) => group.voices).filter((voice) =>
      voiceMatchesTtsLanguage(voice.languageTag, selectedLanguage)
    );
  }, [selectedLanguage]);

  const handleLanguageChange = (code: string) => {
    setSelectedLanguage(code as (typeof AVAILABLE_LANGS)[number]);
    const voices = KOKORO_VOICE_GROUPS.flatMap((group) => group.voices).filter(
      (voice) => voiceMatchesTtsLanguage(voice.languageTag, code)
    );
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
          <DialogDescription>{t("convert.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="tts-language">{t("convert.language")}</Label>
            <Select value={selectedLanguage} onValueChange={handleLanguageChange}>
              <SelectTrigger id="tts-language">
                <SelectValue placeholder={t("common.select_language")} />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_LANGS.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t(`settings.tts_lang_${code}`)}
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
                    {t(voice.nameKey)} (
                    {voice.gender === "Female"
                      ? t("voice.female")
                      : t("voice.male")}
                    )
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
