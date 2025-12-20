import { memo } from "react";
import { ErrorBoundary } from "../../ErrorBoundary";
import type { SettingsState } from "../../../store/slices/settingsSlice";

type SettingsViewProps = {
  settings: SettingsState;
  onSettingsChange: (updates: Partial<SettingsState>) => void;
};

export const SettingsView = memo(function SettingsView({
  settings,
  onSettingsChange,
}: SettingsViewProps) {
  return (
    <ErrorBoundary>
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>

        <div className="space-y-6">
          {/* Theme */}
          <div>
            <label className="block text-sm font-medium mb-2">Theme</label>
            <select
              value={settings.theme}
              onChange={(e) =>
                onSettingsChange({
                  theme: e.target.value as "light" | "dark" | "system",
                })
              }
              className="w-full p-2 border rounded"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>

          {/* Font Size */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Font Size: {settings.fontSize}px
            </label>
            <input
              type="range"
              min="12"
              max="24"
              value={settings.fontSize}
              onChange={(e) =>
                onSettingsChange({ fontSize: parseInt(e.target.value) })
              }
              className="w-full"
            />
          </div>

          {/* Font Family */}
          <div>
            <label className="block text-sm font-medium mb-2">Font Family</label>
            <select
              value={settings.fontFamily}
              onChange={(e) => onSettingsChange({ fontFamily: e.target.value })}
              className="w-full p-2 border rounded"
            >
              <option value="system-ui">System</option>
              <option value="serif">Serif</option>
              <option value="sans-serif">Sans Serif</option>
              <option value="monospace">Monospace</option>
            </select>
          </div>

          {/* Line Height */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Line Height: {settings.lineHeight.toFixed(1)}
            </label>
            <input
              type="range"
              min="1"
              max="2"
              step="0.1"
              value={settings.lineHeight}
              onChange={(e) =>
                onSettingsChange({ lineHeight: parseFloat(e.target.value) })
              }
              className="w-full"
            />
          </div>

          {/* Auto Scroll */}
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.autoScrollEnabled}
                onChange={(e) =>
                  onSettingsChange({ autoScrollEnabled: e.target.checked })
                }
              />
              <span>Auto Scroll (follows audio)</span>
            </label>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
});
