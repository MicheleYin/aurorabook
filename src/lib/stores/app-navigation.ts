import { writable } from "svelte/store";
import type { LibraryFilterOption, LibraryViewMode } from "../types/library";

export type AppView = "library" | "reader" | "settings";

function createAppNavigationStore() {
  const { subscribe: subscribeView, set: setView } = writable<AppView>("library");
  const { subscribe: subscribeSearchTerm, set: setSearchTerm } = writable("");
  const { subscribe: subscribeFilter, set: setFilter } = writable<LibraryFilterOption>("all");
  const { subscribe: subscribeViewMode, set: setViewMode } = writable<LibraryViewMode>("grid");
  const { subscribe: subscribeActiveBookId, set: setActiveBookId } = writable<string | undefined>(undefined);


  return {
    view: { subscribe: subscribeView, set: setView },
    searchTerm: { subscribe: subscribeSearchTerm, set: setSearchTerm },
    filter: { subscribe: subscribeFilter, set: setFilter },
    viewMode: { subscribe: subscribeViewMode, set: setViewMode },
    activeBookId: { subscribe: subscribeActiveBookId, set: setActiveBookId },
  };
}

export const appNavigationStore = createAppNavigationStore();

