import { useEffect, useMemo } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { useKeyboardShortcuts } from "@/context/KeyboardShortcutsContext";
import { useTranslation } from "@/lib/i18n";
import {
  chordFromKeyboardEvent,
  formatShortcutKeys,
  SHORTCUT_GROUP_ORDER,
  type ShortcutActionId,
} from "@/lib/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

export function ShortcutSettingsCard() {
  const { t } = useTranslation();
  const {
    definitions,
    customizedIds,
    isBindingsLoading,
    recordingActionId,
    startRecording,
    cancelRecording,
    setShortcutBinding,
    resetShortcut,
    resetAllShortcuts,
  } = useKeyboardShortcuts();

  const groups = useMemo(() => {
    return SHORTCUT_GROUP_ORDER.map((groupKey) => ({
      groupKey,
      items: definitions.filter((def) => def.groupKey === groupKey),
    })).filter((group) => group.items.length > 0);
  }, [definitions]);

  useEffect(() => {
    if (!recordingActionId) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancelRecording();
        return;
      }

      const captured = chordFromKeyboardEvent(event);
      if (!captured) return;

      event.preventDefault();
      event.stopPropagation();

      const actionId = recordingActionId;
      void (async () => {
        try {
          const result = await setShortcutBinding({
            actionId,
            keys: captured.keys,
            match: [captured.chord],
          });
          if (result.status === "conflict") {
            toast.error(
              t("shortcuts.conflict", { action: t(result.labelKey) })
            );
            return;
          }
          if (result.status === "unchanged") {
            return;
          }
          toast.success(t("shortcuts.saved"));
        } catch {
          toast.error(t("shortcuts.save_failed"));
          cancelRecording();
        }
      })();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recordingActionId, cancelRecording, setShortcutBinding, t]);

  const handleResetOne = async (actionId: ShortcutActionId) => {
    try {
      await resetShortcut(actionId);
      toast.success(t("shortcuts.reset_one"));
    } catch {
      toast.error(t("shortcuts.reset_failed"));
    }
  };

  const handleResetAll = async () => {
    try {
      await resetAllShortcuts();
      toast.success(t("shortcuts.reset_all_done"));
    } catch {
      toast.error(t("shortcuts.reset_failed"));
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>{t("shortcuts.settings_title")}</CardTitle>
          <CardDescription>{t("shortcuts.settings_description")}</CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={isBindingsLoading || customizedIds.size === 0}
          onClick={() => {
            void handleResetAll();
          }}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t("shortcuts.restore_defaults")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {recordingActionId ? (
          <p className="text-sm text-muted-foreground rounded-md border border-dashed px-3 py-2">
            {t("shortcuts.recording_hint")}
          </p>
        ) : null}

        {groups.map((group) => (
          <section key={group.groupKey} className="space-y-2">
            <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {t(group.groupKey)}
            </h3>
            <ul className="divide-y rounded-md border">
              {group.items.map((item) => {
                const isRecording = recordingActionId === item.id;
                const isCustom = customizedIds.has(item.id);
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {t(item.labelKey)}
                      </p>
                      {isCustom ? (
                        <p className="text-muted-foreground text-xs">
                          {t("shortcuts.customized")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={`inline-flex min-h-8 min-w-[5.5rem] items-center justify-center rounded-md border px-2 transition-colors ${
                          isRecording
                            ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                            : "border-border bg-muted/40 hover:bg-muted"
                        }`}
                        onClick={() => {
                          if (isRecording) {
                            cancelRecording();
                          } else {
                            startRecording(item.id);
                          }
                        }}
                        aria-label={t("shortcuts.change_binding", {
                          action: t(item.labelKey),
                        })}
                      >
                        {isRecording ? (
                          <span className="text-muted-foreground text-xs">
                            {t("shortcuts.press_key")}
                          </span>
                        ) : (
                          <KbdGroup>
                            {formatShortcutKeys(item.keys).map((key, index) => (
                              <span
                                key={`${item.id}-${key}`}
                                className="inline-flex items-center gap-1"
                              >
                                {index > 0 ? (
                                  <span className="text-muted-foreground text-[10px]">
                                    {t("shortcuts.or")}
                                  </span>
                                ) : null}
                                <Kbd>{key}</Kbd>
                              </span>
                            ))}
                          </KbdGroup>
                        )}
                      </button>
                      {isCustom ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2"
                          onClick={() => {
                            void handleResetOne(item.id);
                          }}
                          title={t("shortcuts.reset_one_title")}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
