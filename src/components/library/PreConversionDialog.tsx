import { Play, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_KOKORO_VOICE_ID, KOKORO_VOICE_GROUPS } from "../../constants/kokoro";
import {
    AVAILABLE_LANGS,
    normalizeTtsLanguage,
    voiceMatchesTtsLanguage,
} from "../../constants/languages";
import { useTranslation } from "../../lib/i18n";
import { Button } from "../ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui/select";

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
    () => normalizeTtsLanguage(defaultLanguage),
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

  const handleLanguageChange = (code: string | undefined) => {
    if (!code) return;
    setSelectedLanguage(normalizeTtsLanguage(code));
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
            <Play className="h-6 w-6 text-primary" />
            {t("convert.title")}
          </DialogTitle>
          <DialogDescription>{t("convert.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="tts-language">{t("convert.language")}</Label>
            <Select clearable={false} value={selectedLanguage} onValueChange={handleLanguageChange}>
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
            <Select
              clearable={false}
              value={selectedVoice}
              onValueChange={(value) => {
                if (value) setSelectedVoice(value);
              }}
            >
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

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="gap-2">
            <X className="h-6 w-6" />
            {t("convert.cancel")}
          </Button>
          <Button onClick={handleConfirm} className="gap-2">
            <Play className="h-6 w-6" />
            {t("convert.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
