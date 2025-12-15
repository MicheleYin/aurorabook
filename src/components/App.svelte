<script lang="ts">
  import LibraryPanel from "./LibraryPanel.svelte";
  import ReaderPanel from "./ReaderPanel.svelte";
  import SettingsPanel from "./SettingsPanel.svelte";
  import BottomNavigation from "./BottomNavigation.svelte";

  type AppView = "library" | "reader" | "settings";

  let activeView: AppView = $state("library");

  // Navigation items - for now, reader is always enabled
  // This will be updated when library state is added
  const navigationItems: Array<{ id: AppView; label: string; disabled?: boolean }> = [
    { id: "library", label: "Library" },
    { id: "reader", label: "Reader", disabled: false },
    { id: "settings", label: "Settings" },
  ];

  function handleViewChange(view: AppView) {
    activeView = view;
  }

  function getCurrentView() {
    switch (activeView) {
      case "library":
        return LibraryPanel;
      case "reader":
        return ReaderPanel;
      case "settings":
        return SettingsPanel;
      default:
        return LibraryPanel;
    }
  }
</script>

<div class="flex min-h-screen flex-col bg-background text-foreground">
  <div class="mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
    <div class="flex flex-1 min-h-0 flex-col">
      <svelte:component this={getCurrentView()} />
    </div>
  </div>
  <BottomNavigation
    {activeView}
    {navigationItems}
    onViewChange={handleViewChange}
    hideNavigation={false}
  />
</div>

