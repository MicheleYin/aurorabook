import { useMemo } from "react";

import { useKeyboardShortcuts } from "@/context/KeyboardShortcutsContext";
import { useTranslation } from "@/lib/i18n";
import {
  formatShortcutKeys,
  SHORTCUT_GROUP_ORDER,
} from "@/lib/keyboard-shortcuts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

export function ShortcutsHelpDialog() {
  const { t } = useTranslation();
  const { isHelpOpen, closeHelp, definitions } = useKeyboardShortcuts();

  const groups = useMemo(() => {
    return SHORTCUT_GROUP_ORDER.map((groupKey) => ({
      groupKey,
      items: definitions.filter((def) => def.groupKey === groupKey),
    })).filter((group) => group.items.length > 0);
  }, [definitions]);

  return (
    <Dialog open={isHelpOpen} onOpenChange={(open) => !open && closeHelp()}>
      <DialogContent
        maxWidth="2xl"
        className="flex max-h-[min(85vh,40rem)] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 border-b px-6 py-5 text-left">
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-6 pb-2">
            {groups.map((group) => (
              <section key={group.groupKey} className="space-y-3">
                <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  {t(group.groupKey)}
                </h3>
                <ul className="space-y-2">
                  {group.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-4 py-1.5"
                    >
                      <span className="text-sm text-foreground">
                        {t(item.labelKey)}
                      </span>
                      <KbdGroup className="shrink-0">
                        {formatShortcutKeys(item.keys).map((key, index) => (
                          <span
                            key={`${item.id}-${key}`}
                            className="inline-flex items-center gap-1.5"
                          >
                            {index > 0 ? (
                              <span className="text-muted-foreground text-xs">
                                {t("shortcuts.or")}
                              </span>
                            ) : null}
                            <Kbd>{key}</Kbd>
                          </span>
                        ))}
                      </KbdGroup>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
