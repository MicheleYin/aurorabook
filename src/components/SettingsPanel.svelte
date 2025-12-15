<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Check from "@lucide/svelte/icons/check";
  import Play from "@lucide/svelte/icons/play";
  import Pause from "@lucide/svelte/icons/pause";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import HelpCircle from "@lucide/svelte/icons/help-circle";
  import { invoke } from "@tauri-apps/api/core";
  import { settingsStore } from "$lib/stores/settings";
  
  // Create a derived store for hydrated state
  const settingsStoreHydrated = {
    subscribe: settingsStore.hydrated.subscribe
  };
  import { KOKORO_VOICE_GROUPS } from "$lib/constants/kokoro";
  import type { AppSettings } from "$lib/types/settings";
  import type { UITheme } from "$lib/types/ui";
  import ThemeSwitcher from "./ThemeSwitcher.svelte";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectGroupHeading,
    SelectTrigger,
  } from "$lib/components/ui/select";
  import { Button } from "$lib/components/ui/button";
  import { cn } from "$lib/utils";

  type FAQItem = {
    question: string;
    answer: string;
  };

  const FAQ_DATA: FAQItem[] = [
    {
      question: "How does it work?",
      answer: "The application uses local TTS (Text-to-Speech) models, specifically Kokoro, combined with Espeak or Phonetisaurus. These tools provide grapheme-to-phoneme conversion (converting written text to phonetic sounds) and phoneme-to-audio conversion (turning phonetic sounds into spoken audio). Everything runs entirely on your device—no cloud services required.",
    },
    {
      question: "Is my data safe?",
      answer: "Yes, your data is completely safe. All processing happens locally on your device. No internet connection is required, and your books, audio files, and personal information never leave your computer. Your privacy is fully protected.",
    },
    {
      question: "Why is it so slow?",
      answer: "Text-to-speech conversion is computationally demanding. The process involves complex neural network models that generate high-quality audio, which requires significant processing power. The speed depends on your device's CPU capabilities and the length of the content being converted. There are plans to improve the speed in the future",
    },
    {
      question: "Can I listen to chapters immediately?",
      answer: "Yes! You can listen to a chapter as soon as that specific chapter finishes converting. You don't need to wait for the entire book to be completed. This allows you to start enjoying your audiobook while the rest of the book continues processing in the background.",
    },
    {
      question: "What file formats are supported?",
      answer: "The application supports EPUB files for conversion to audiobooks. EPUB is a widely-used ebook format that preserves the structure and formatting of books, making it ideal for creating well-organized audiobooks with proper chapter divisions.",
    },
    {
      question: "Can I customize the voice?",
      answer: "Yes! You can choose from multiple voices available in the Kokoro model. Each voice has different characteristics including language, gender, and speaking style. You can preview voices before selecting one, and your choice will be saved as your default preference.",
    },
    {
      question: "Where are the audio files stored?",
      answer: "All generated audio files are stored locally on your device. They are organized alongside your book library and remain accessible even when offline. You can manage and delete these files through the application's library interface.",
    },
    {
      question: "Can I pause or cancel a conversion?",
      answer: "Yes, you can cancel an ongoing conversion at any time. If you cancel, any chapters that have already been completed will remain available for listening. You can resume or restart the conversion later if needed.",
    },
  ];

  // Use store auto-subscription with $ prefix (Svelte 5 syntax)
  // Direct store access - Svelte will auto-subscribe
  let showSaved = $state(false);
  let playingVoiceId = $state<string | null>(null);
  let expandedFAQ = $state<number | null>(null);
  let audioRef: HTMLAudioElement | null = $state(null);
  let blobUrl: string | null = $state(null);
  let savedTimeout: ReturnType<typeof setTimeout> | null = null;

  // Subscribe to hydrated state
  let isHydrated = $state(false);
  $effect(() => {
    const unsubscribe = settingsStore.hydrated.subscribe((value) => {
      isHydrated = value;
    });
    return unsubscribe;
  });

  // Helper function to show "Saved" animation
  function showSavedAnimation() {
    showSaved = true;
    if (savedTimeout) clearTimeout(savedTimeout);
    savedTimeout = setTimeout(() => {
      showSaved = false;
    }, 2000);
  }

  // Derive current theme from store for reactivity
  let currentTheme = $derived($settingsStore.theme);

  // Voice selection state - bind to store value
  let selectedVoiceId = $state($settingsStore.ttsVoiceId);

  // Sync with store changes
  $effect(() => {
    selectedVoiceId = $settingsStore.ttsVoiceId;
  });

  function handleThemeChange(theme: UITheme) {
    settingsStore.updateSettings({ theme });
    showSavedAnimation();
  }

  function handleVoiceChange(voiceId: string) {
    settingsStore.updateSettings({
      ttsVoiceId: voiceId as AppSettings["ttsVoiceId"],
    });
    showSavedAnimation();
  }

  // Find the currently selected voice - use selectedVoiceId for reactivity
  let selectedVoice = $derived.by(() => {
    const allVoices = KOKORO_VOICE_GROUPS.flatMap((group) => group.voices);
    return allVoices.find((voice) => voice.id === selectedVoiceId);
  });

  async function handlePlaySample(voiceId: string, sampleUrl: string) {
    // If clicking the same voice that's playing, pause it
    if (playingVoiceId === voiceId && audioRef) {
      audioRef.pause();
      audioRef.currentTime = 0;
      playingVoiceId = null;
      return;
    }

    // Stop any currently playing audio
    if (audioRef) {
      audioRef.pause();
      audioRef.currentTime = 0;
    }

    // Clean up previous blob URL
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }

    try {
      // Load resource file from bundle (sampleUrl is like "voice-samples/af_heart.mp3")
      const fileData = await invoke<number[]>("read_resource_file", {
        resourcePath: sampleUrl,
      });

      // Convert number array to Uint8Array
      const uint8Array = new Uint8Array(fileData);

      // Create blob URL
      const blob = new Blob([uint8Array], { type: "audio/mpeg" });
      const newBlobUrl = URL.createObjectURL(blob);
      blobUrl = newBlobUrl;

      // Create new audio element if needed
      if (!audioRef) {
        audioRef = new Audio();
        audioRef.addEventListener("ended", () => {
          playingVoiceId = null;
        });
        audioRef.addEventListener("error", () => {
          console.error("Failed to play voice sample:", sampleUrl);
          playingVoiceId = null;
        });
      }

      // Play the new sample
      audioRef.src = newBlobUrl;
      await audioRef.play();
      playingVoiceId = voiceId;
    } catch (error) {
      console.error("Failed to load voice sample:", error);
      playingVoiceId = null;
    }
  }

  function handleToggleFAQ(index: number) {
    expandedFAQ = expandedFAQ === index ? null : index;
  }

  // Cleanup audio and blob URLs on unmount
  onDestroy(() => {
    if (audioRef) {
      audioRef.pause();
      audioRef = null;
    }
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    if (savedTimeout) {
      clearTimeout(savedTimeout);
    }
  });
</script>

<div class="flex h-full flex-col gap-6 safe-area-top">
  <Card class="flex-1">
    <CardHeader class="relative">
      <CardTitle class="text-xl">Preferences</CardTitle>
      <CardDescription>Control the Reader theme and voice settings from one place.</CardDescription>
      <!-- Saved confirmation animation -->
      <div
        class={cn(
          "absolute right-4 top-4 flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-sm text-primary",
          "transition-all duration-300 ease-in-out",
          showSaved
            ? "opacity-100 translate-y-0 scale-100"
            : "opacity-0 translate-y-2 scale-95 pointer-events-none"
        )}
      >
        <Check class="h-4 w-4" />
        <span>Saved</span>
      </div>
    </CardHeader>
    <CardContent>
      <div class="space-y-6">
        <div class="w-full flex flex-col gap-4 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="font-medium">Theme</p>
            <p class="text-sm text-muted-foreground">
              Switch between light, dark, or follow your system setting.
            </p>
          </div>
          <div class="flex w-full justify-center sm:w-auto sm:justify-end">
            <ThemeSwitcher value={currentTheme} onChange={handleThemeChange} />
          </div>
        </div>

        <div class="flex flex-col gap-2 rounded-lg border border-dashed p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div class="flex-1">
            <p class="font-medium">Default voice</p>
            <p class="text-sm text-muted-foreground">
              Select the voice used for previews and on-device narration.
            </p>
          </div>
          <div class="sm:max-w-xs w-full">
            <Select
              type="single"
              value={selectedVoiceId}
              onValueChange={(value: string | undefined) => {
                if (value && value !== selectedVoiceId) {
                  handleVoiceChange(value);
                }
              }}
            >
              <SelectTrigger class="w-full">
                {selectedVoice?.name || "Choose a voice"}
              </SelectTrigger>
              <SelectContent>
                {#each KOKORO_VOICE_GROUPS as group}
                  <SelectGroup>
                    <SelectGroupHeading>{group.label}</SelectGroupHeading>
                    {#each group.voices as voice}
                      <SelectItem value={voice.id} label={voice.name}>
                        {voice.name}
                      </SelectItem>
                    {/each}
                  </SelectGroup>
                {/each}
              </SelectContent>
            </Select>
          </div>
        </div>

        <!-- Voice Preview Component -->
        {#if selectedVoice}
          <div class="rounded-lg border bg-gradient-to-br from-muted/50 to-muted/30 p-4 transition-all duration-300">
            <div class="flex items-start gap-4">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-2">
                  <Volume2 class="h-4 w-4 text-muted-foreground" />
                  <h4 class="font-semibold text-sm">Voice Preview</h4>
                </div>
                <div class="space-y-1">
                  <p class="font-medium text-base">{selectedVoice.name}</p>
                  <div class="flex items-center gap-2 text-xs text-muted-foreground">
                    <span class="px-2 py-0.5 rounded-full bg-background/60 border border-border/40">
                      {selectedVoice.languageTag.toUpperCase()}
                    </span>
                    <span class="px-2 py-0.5 rounded-full bg-background/60 border border-border/40">
                      {selectedVoice.gender}
                    </span>
                    <span class="text-muted-foreground/80">{selectedVoice.summary}</span>
                  </div>
                </div>
              </div>
              <Button
                variant="secondary"
                size="lg"
                class="shrink-0 gap-2 min-w-[140px] justify-center"
                onclick={() => handlePlaySample(selectedVoice.id, selectedVoice.sampleUrl)}
                aria-label={playingVoiceId === selectedVoice.id ? `Pause sample for ${selectedVoice.name}` : `Play sample for ${selectedVoice.name}`}
              >
                {#if playingVoiceId === selectedVoice.id}
                  <Pause class="h-4 w-4" aria-hidden="true" />
                  <span>Pause</span>
                {:else}
                  <Play class="h-4 w-4" aria-hidden="true" />
                  <span>Play</span>
                {/if}
              </Button>
            </div>
          </div>
        {/if}
      </div>
    </CardContent>
  </Card>

  <!-- FAQ Section -->
  <Card>
    <CardHeader>
      <div class="flex items-center gap-2">
        <HelpCircle class="h-5 w-5 text-muted-foreground" />
        <CardTitle class="text-xl">Frequently Asked Questions</CardTitle>
      </div>
      <CardDescription>Find answers to common questions about the application.</CardDescription>
    </CardHeader>
    <CardContent>
      <div class="space-y-2">
        {#each FAQ_DATA as faq, index}
          {@const isExpanded = expandedFAQ === index}
          <div
            class="rounded-lg border bg-card transition-all duration-200 hover:bg-muted/30"
          >
            <button
              onclick={() => handleToggleFAQ(index)}
              class="w-full flex items-center justify-between p-4 text-left gap-4 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-lg"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? `Collapse ${faq.question}` : `Expand ${faq.question}`}
            >
              <span class="font-semibold text-sm sm:text-base pr-4">{faq.question}</span>
              <div class="shrink-0">
                {#if isExpanded}
                  <ChevronUp class="h-5 w-5 text-muted-foreground transition-transform" />
                {:else}
                  <ChevronDown class="h-5 w-5 text-muted-foreground transition-transform" />
                {/if}
              </div>
            </button>
            {#if isExpanded}
              <div
                class={cn(
                  "px-4 pb-4 text-sm text-muted-foreground leading-relaxed",
                  "animate-in slide-in-from-top-1 fade-in-0 duration-200"
                )}
              >
                <p class="whitespace-pre-line">{faq.answer}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </CardContent>
  </Card>
  <div class="pb-10"></div>
</div>
