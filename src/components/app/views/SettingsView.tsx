import { memo } from "react";
import { ErrorBoundary } from "../../ErrorBoundary";
import { SettingsPanel } from "../../SettingsPanel";
import type { Settings } from "../../../types/settings";

type SettingsViewProps = {
  settings: Settings;
  onSettingsChange: (settings: Partial<Settings>) => void;
};

export const SettingsView = memo(function SettingsView({
  settings,
  onSettingsChange,
}: SettingsViewProps) {
  return (
    <ErrorBoundary>
      <SettingsPanel settings={settings} onSettingsChange={onSettingsChange} />
    </ErrorBoundary>
  );
});

