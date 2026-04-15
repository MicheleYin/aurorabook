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

export function TtsLanguageSelect() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useSettingsContext();

  const handleLanguageChange = (value: string) => {
    void saveSettings({ ttsLanguage: value });
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
          <SelectItem value="en">English (en-us)</SelectItem>
          <SelectItem value="es">Español (es-es)</SelectItem>
          <SelectItem value="it">Italiano (it-it)</SelectItem>
          <SelectItem value="zh">中文 (zh-cn)</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t("settings.tts_language_description")}
      </p>
    </div>
  );
}
