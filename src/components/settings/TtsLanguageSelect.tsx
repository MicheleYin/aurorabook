import { useSettingsContext } from "../../context/SettingsContext";
import { useTranslation } from "../../lib/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Label } from "../ui/label";
import { AVAILABLE_LANGS } from "../../constants/languages";
import { KOKORO_VOICE_GROUPS } from "../../constants/kokoro";

export function TtsLanguageSelect() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useSettingsContext();

  const handleLanguageChange = (value: string) => {
    const firstVoice = KOKORO_VOICE_GROUPS.flatMap((g) => g.voices)[0];

    void saveSettings({
      ttsLanguage: value,
      ttsVoiceId: firstVoice?.id ?? settings?.ttsVoiceId,
    });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="tts-language-select">{t("settings.tts_language")}</Label>
      <Select
        value={settings?.ttsLanguage || "en"}
        onValueChange={handleLanguageChange}
      >
        <SelectTrigger id="tts-language-select" className="w-full">
          <SelectValue placeholder={t("settings.tts_language")} />
        </SelectTrigger>
        <SelectContent>
          {AVAILABLE_LANGS.map((code) => (
            <SelectItem key={code} value={code}>
              {t(`settings.tts_lang_${code}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t("settings.tts_language_description")}
      </p>
    </div>
  );
}
