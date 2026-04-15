import { useTranslation, type Language } from "../../lib/i18n";
import { useSettingsContext } from "../../context/SettingsContext";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Label } from "../ui/label";

export function LanguageSelect() {
  const { t, lang, changeLanguage } = useTranslation();
  const { settings, saveSettings } = useSettingsContext();

  const handleLanguageChange = async (value: string) => {
    // 1. Update i18n local state
    await changeLanguage(value as Language);
    // 2. Persist to backend settings
    await saveSettings({ language: value });
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="language-select">{t("app.language")}</Label>
      <Select
        value={settings?.language || lang}
        onValueChange={handleLanguageChange}
      >
        <SelectTrigger id="language-select" className="w-full">
          <SelectValue placeholder={t("app.language")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="en">English</SelectItem>
          <SelectItem value="es">Español</SelectItem>
          <SelectItem value="it">Italiano</SelectItem>
          <SelectItem value="zh">中文</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t("settings.language_description")}
      </p>
    </div>
  );
}
