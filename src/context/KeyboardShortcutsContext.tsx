import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";

import { useAppContext, type TabValue } from "@/context/AppContext";
import {
  bindingEquivalentTo,
  findBindingConflict,
  getDefaultShortcutDefinition,
  isEditableKeyboardTarget,
  isShortcutActionId,
  matchesShortcut,
  parseStoredBindings,
  resolveShortcutDefinitions,
  scopesInclude,
  type ShortcutActionId,
  type ShortcutDefinition,
  type ShortcutHandler,
  type ShortcutScope,
  type StoredShortcutBinding,
} from "@/lib/keyboard-shortcuts";
import { logger } from "@/lib/logger";

type ActionMap = Partial<Record<ShortcutActionId, ShortcutHandler>>;

export type SetShortcutBindingResult =
  | { status: "saved" }
  | { status: "unchanged" }
  | { status: "conflict"; labelKey: string };

interface KeyboardShortcutsContextValue {
  isHelpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  registerActions: (actions: ActionMap) => () => void;
  /** Effective definitions (defaults merged with SQLite overrides). */
  definitions: ShortcutDefinition[];
  /** Action ids that have a custom binding in the DB. */
  customizedIds: ReadonlySet<ShortcutActionId>;
  isBindingsLoading: boolean;
  recordingActionId: ShortcutActionId | null;
  startRecording: (actionId: ShortcutActionId) => void;
  cancelRecording: () => void;
  setShortcutBinding: (
    binding: StoredShortcutBinding
  ) => Promise<SetShortcutBindingResult>;
  resetShortcut: (actionId: ShortcutActionId) => Promise<void>;
  resetAllShortcuts: () => Promise<void>;
}

const KeyboardShortcutsContext =
  createContext<KeyboardShortcutsContextValue | null>(null);

function tabToScope(tab: TabValue): ShortcutScope {
  if (tab === "reader") return "reader";
  if (tab === "library") return "library";
  return "global";
}

export function KeyboardShortcutsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { currentTab, setCurrentTab, currentBook } = useAppContext();
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [overrides, setOverrides] = useState<
    Map<ShortcutActionId, StoredShortcutBinding>
  >(() => new Map());
  const [isBindingsLoading, setIsBindingsLoading] = useState(true);
  const [recordingActionId, setRecordingActionId] =
    useState<ShortcutActionId | null>(null);
  const actionsRef = useRef<ActionMap>({});
  const isHelpOpenRef = useRef(false);
  const recordingActionIdRef = useRef<ShortcutActionId | null>(null);
  isHelpOpenRef.current = isHelpOpen;
  recordingActionIdRef.current = recordingActionId;

  const definitions = useMemo(
    () => resolveShortcutDefinitions(overrides),
    [overrides]
  );
  const definitionsRef = useRef(definitions);
  definitionsRef.current = definitions;

  const customizedIds = useMemo(
    () => new Set(overrides.keys()),
    [overrides]
  );

  const openHelp = useCallback(() => setIsHelpOpen(true), []);
  const closeHelp = useCallback(() => setIsHelpOpen(false), []);
  const toggleHelp = useCallback(() => setIsHelpOpen((open) => !open), []);
  const startRecording = useCallback((actionId: ShortcutActionId) => {
    setIsHelpOpen(false);
    setRecordingActionId(actionId);
  }, []);
  const cancelRecording = useCallback(() => setRecordingActionId(null), []);

  const registerActions = useCallback((actions: ActionMap) => {
    const ids = Object.keys(actions) as ShortcutActionId[];
    for (const id of ids) {
      const handler = actions[id];
      if (handler) actionsRef.current[id] = handler;
    }
    return () => {
      for (const id of ids) {
        if (actionsRef.current[id] === actions[id]) {
          delete actionsRef.current[id];
        }
      }
    };
  }, []);

  const loadBindings = useCallback(async () => {
    try {
      setIsBindingsLoading(true);
      const rows = await invoke<
        Array<{ actionId: string; keys: string[]; match: unknown }>
      >("get_keyboard_shortcuts");
      const parsed = parseStoredBindings(rows);
      setOverrides(parsed);

      // Clean DB rows that match defaults (no-op customizations).
      for (const row of rows) {
        if (!isShortcutActionId(row.actionId)) continue;
        if (parsed.has(row.actionId)) continue;
        void invoke("reset_keyboard_shortcut", {
          actionId: row.actionId,
        }).catch(() => {
          /* best-effort cleanup */
        });
      }
    } catch (err) {
      logger.error("Failed to load keyboard shortcuts:", err);
      setOverrides(new Map());
    } finally {
      setIsBindingsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBindings();
  }, [loadBindings]);

  const setShortcutBinding = useCallback(
    async (binding: StoredShortcutBinding): Promise<SetShortcutBindingResult> => {
      const currentDef = definitionsRef.current.find(
        (def) => def.id === binding.actionId
      );
      if (
        currentDef &&
        bindingEquivalentTo(binding.match, currentDef.match)
      ) {
        setRecordingActionId(null);
        return { status: "unchanged" };
      }

      const defaults = getDefaultShortcutDefinition(binding.actionId);
      if (defaults && bindingEquivalentTo(binding.match, defaults.match)) {
        // Same as built-in default — drop any override so reset stays hidden.
        try {
          await invoke("reset_keyboard_shortcut", {
            actionId: binding.actionId,
          });
          setOverrides((prev) => {
            if (!prev.has(binding.actionId)) return prev;
            const next = new Map(prev);
            next.delete(binding.actionId);
            return next;
          });
          setRecordingActionId(null);
          return { status: "unchanged" };
        } catch (err) {
          logger.error("Failed to clear default-equivalent shortcut:", err);
          throw err;
        }
      }

      const conflict = findBindingConflict(
        definitionsRef.current,
        binding.actionId,
        binding.match
      );
      if (conflict) {
        return { status: "conflict", labelKey: conflict.labelKey };
      }

      try {
        await invoke("upsert_keyboard_shortcut", {
          binding: {
            actionId: binding.actionId,
            keys: binding.keys,
            match: binding.match,
          },
        });
        setOverrides((prev) => {
          const next = new Map(prev);
          next.set(binding.actionId, binding);
          return next;
        });
        setRecordingActionId(null);
        return { status: "saved" };
      } catch (err) {
        logger.error("Failed to save keyboard shortcut:", err);
        throw err;
      }
    },
    []
  );

  const resetShortcut = useCallback(async (actionId: ShortcutActionId) => {
    try {
      await invoke("reset_keyboard_shortcut", { actionId });
      setOverrides((prev) => {
        const next = new Map(prev);
        next.delete(actionId);
        return next;
      });
      setRecordingActionId((current) =>
        current === actionId ? null : current
      );
    } catch (err) {
      logger.error("Failed to reset keyboard shortcut:", err);
      throw err;
    }
  }, []);

  const resetAllShortcuts = useCallback(async () => {
    try {
      await invoke("reset_all_keyboard_shortcuts");
      setOverrides(new Map());
      setRecordingActionId(null);
    } catch (err) {
      logger.error("Failed to reset keyboard shortcuts:", err);
      throw err;
    }
  }, []);

  useEffect(() => {
    const builtIn: ActionMap = {
      showHelp: () => {
        toggleHelp();
      },
      goSettings: () => {
        setIsHelpOpen(false);
        setCurrentTab("settings");
      },
      goLibrary: () => {
        setIsHelpOpen(false);
        setCurrentTab("library");
      },
      goReader: () => {
        if (!currentBook) return false;
        setIsHelpOpen(false);
        setCurrentTab("reader");
      },
    };
    return registerActions(builtIn);
  }, [currentBook, registerActions, setCurrentTab, toggleHelp]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;

      // While remapping a shortcut, let the settings UI capture the key.
      if (recordingActionIdRef.current) return;

      const editable = isEditableKeyboardTarget(event.target);
      const activeScope = tabToScope(currentTab);
      const defs = definitionsRef.current;

      for (const def of defs) {
        if (!matchesShortcut(event, def)) continue;

        // While typing, only allow Escape / help toggle.
        if (
          editable &&
          def.id !== "closeOverlays" &&
          def.id !== "showHelp"
        ) {
          continue;
        }

        if (
          isHelpOpenRef.current &&
          def.id !== "closeOverlays" &&
          def.id !== "showHelp"
        ) {
          continue;
        }

        if (!scopesInclude(def.scope, activeScope)) continue;

        if (def.id === "closeOverlays" && isHelpOpenRef.current) {
          setIsHelpOpen(false);
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        const handler = actionsRef.current[def.id];
        if (!handler) continue;

        const result = handler();
        if (result === false) continue;

        event.preventDefault();
        event.stopPropagation();
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [currentTab]);

  const value = useMemo(
    () => ({
      isHelpOpen,
      openHelp,
      closeHelp,
      toggleHelp,
      registerActions,
      definitions,
      customizedIds,
      isBindingsLoading,
      recordingActionId,
      startRecording,
      cancelRecording,
      setShortcutBinding,
      resetShortcut,
      resetAllShortcuts,
    }),
    [
      isHelpOpen,
      openHelp,
      closeHelp,
      toggleHelp,
      registerActions,
      definitions,
      customizedIds,
      isBindingsLoading,
      recordingActionId,
      startRecording,
      cancelRecording,
      setShortcutBinding,
      resetShortcut,
      resetAllShortcuts,
    ]
  );

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcuts() {
  const ctx = useContext(KeyboardShortcutsContext);
  if (!ctx) {
    throw new Error(
      "useKeyboardShortcuts must be used within KeyboardShortcutsProvider"
    );
  }
  return ctx;
}

/** Register shortcut handlers for the lifetime of the caller. */
export function useRegisterShortcutActions(actions: ActionMap) {
  const { registerActions } = useKeyboardShortcuts();
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    const ids = Object.keys(actionsRef.current) as ShortcutActionId[];
    const wrapped: ActionMap = {};
    for (const id of ids) {
      wrapped[id] = () => actionsRef.current[id]?.();
    }
    return registerActions(wrapped);
  }, [registerActions]);
}
