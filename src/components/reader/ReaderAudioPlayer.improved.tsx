/**
 * IMPROVED VERSION - Track Loading Section
 * This shows the simplified approach for track loading in ReaderAudioPlayer
 * 
 * Key improvements:
 * 1. Pre-load track URL in separate effect (prevents re-render loops)
 * 2. Simplified setupAudioSource function (extracted helpers)
 * 3. Consolidated event handlers
 * 4. Better state management
 */

// ============================================================================
// IMPROVEMENT 1: Pre-load Track URL Before Main Effect
// ============================================================================

// Replace the on-demand loading in the main effect with this separate effect
useEffect(() => {
  if (!currentTrack || !bookId || currentTrack.url) {
    return;
  }
  
  let cancelled = false;
  
  console.log("[Audio Player] Pre-loading track URL", {
    trackId: currentTrack.id,
    trackTitle: currentTrack.title,
    href: currentTrack.href,
  });
  
  ensureAudioTrackLoaded(bookId, currentTrack)
    .then((loadedTrack) => {
      if (!cancelled) {
        setLoadedTracks((prev) => {
          const updated = [...prev];
          const index = updated.findIndex((t) => t.id === loadedTrack.id);
          if (index !== -1) {
            updated[index] = loadedTrack;
          }
          return updated;
        });
      }
    })
    .catch((error) => {
      if (!cancelled) {
        console.error("[Audio Player] Failed to pre-load audio track", {
          trackId: currentTrack.id,
          trackTitle: currentTrack.title,
          error,
        });
      }
    });
  
  return () => {
    cancelled = true;
  };
}, [currentTrack?.id, bookId, currentTrack?.url]);

// ============================================================================
// IMPROVEMENT 2: Extract Helper Functions
// ============================================================================

// Extract autoplay logic into reusable function
const attemptAutoplay = useCallback(async (
  audio: HTMLAudioElement,
  shouldPlay: boolean
): Promise<boolean> => {
  if (!shouldPlay || !audio.paused) {
    return false;
  }
  
  try {
    await audio.play();
    setIsPlaying(true);
    isPlayingRef.current = true;
    console.log("[Audio Player] Autoplay succeeded");
    return true;
  } catch (error) {
    console.warn("[Audio Player] Autoplay failed:", error);
    setIsPlaying(false);
    isPlayingRef.current = false;
    return false;
  }
}, []);

// Check if audio is ready and attempt play
const tryPlayIfReady = useCallback((
  audio: HTMLAudioElement,
  shouldAutoplay: boolean
): boolean => {
  if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && audio.paused) {
    attemptAutoplay(audio, shouldAutoplay);
    return true;
  }
  return false;
}, [attemptAutoplay]);

// ============================================================================
// IMPROVEMENT 3: Simplified setupAudioSource Function
// ============================================================================

// Replace the complex nested setupAudioSource (lines 463-661) with this:

const setupAudioSource = useCallback((
  audio: HTMLAudioElement,
  track: AudioTrack
) => {
  // Determine if we should autoplay after loading
  const wasPlaying = isPlayingRef.current || !audio.paused;
  const shouldAutoplay = wasPlaying;
  
  console.log("[Audio Player] Setting up audio source", {
    trackId: track.id,
    trackTitle: track.title,
    wasPlaying,
    shouldAutoplay,
    isRestoring: isRestoringRef.current,
  });
  
  // Notify hook about track change
  onTrackChanged(track.id);
  
  // Reset restoration flag
  trackLoadedForRestorationRef.current = isRestoringRef.current;
  
  // Update playing state if we were playing
  if (shouldAutoplay) {
    isPlayingRef.current = true;
    setIsPlaying(true);
  }
  
  // Set audio source
  audio.src = track.url!;
  audio.load();
  audio.playbackRate = playbackRate;
  
  // Reset time if not restoring
  if (!isRestoringRef.current) {
    audio.currentTime = 0;
    setCurrentTime(0);
    currentTimeRef.current = 0;
  }
  
  // Try immediate play if audio is already ready (cached)
  if (tryPlayIfReady(audio, shouldAutoplay)) {
    return; // Already playing, no need for event listener
  }
  
  // Set up event listener for when audio becomes ready
  const handleCanPlay = () => {
    audio.removeEventListener("canplay", handleCanPlay);
    if (shouldAutoplay) {
      attemptAutoplay(audio, true);
    }
  };
  
  audio.addEventListener("canplay", handleCanPlay);
  
  // Return cleanup function
  return () => {
    audio.removeEventListener("canplay", handleCanPlay);
  };
}, [playbackRate, onTrackChanged, tryPlayIfReady, attemptAutoplay]);

// ============================================================================
// IMPROVEMENT 4: Simplified Main Track Loading Effect
// ============================================================================

// Replace the complex effect (lines 423-662) with this simplified version:

useEffect(() => {
  const audio = audioRef.current;
  if (!audio || !currentTrack || !bookId) {
    return;
  }

  // If track URL is missing, the pre-load effect will handle it
  // This effect will re-run when the URL is loaded
  if (!currentTrack.url) {
    console.log("[Audio Player] Waiting for track URL to load", {
      trackId: currentTrack.id,
    });
    return;
  }

  // Setup audio source with loaded track
  const cleanup = setupAudioSource(audio, currentTrack);
  
  return cleanup;
}, [currentIndex, currentTrack?.id, currentTrack?.url, bookId, setupAudioSource]);

// ============================================================================
// IMPROVEMENT 5: Consolidated Event Handlers
// ============================================================================

// In the main audio effect (lines 200-383), simplify the handlers:

const handleAudioReady = useCallback((event: Event) => {
  const audio = event.target as HTMLAudioElement;
  
  console.log("[Audio Player] Audio ready event", {
    readyState: audio.readyState,
    isRestoring: trackLoadedForRestorationRef.current,
  });
  
  // Handle restoration if needed
  if (trackLoadedForRestorationRef.current) {
    onTrackLoadedRef.current(audio);
    trackLoadedForRestorationRef.current = false;
  } else {
    // Normal playback - emit progress if needed
    const audioTime = audio.currentTime || 0;
    if (audioTime > 0) {
      emitProgressRef.current(audioTime);
    }
  }
}, []);

// Use single event listener instead of multiple
audio.addEventListener("canplay", handleAudioReady);

// Remove the separate handleCanPlay function (lines 306-327)
// The handleAudioReady above replaces it

// ============================================================================
// SUMMARY OF CHANGES
// ============================================================================

/**
 * Before:
 * - 200+ line nested setupAudioSource function
 * - On-demand loading in main effect causing re-renders
 * - Multiple overlapping event handlers
 * - Complex autoplay logic with multiple fallbacks
 * - Multiple sources of truth for playing state
 * 
 * After:
 * - ~50 line setupAudioSource with extracted helpers
 * - Pre-loading in separate effect (no re-render loops)
 * - Single unified event handler
 * - Simple autoplay with one attempt + event listener
 * - Clear separation of concerns
 * 
 * Benefits:
 * - Easier to understand and maintain
 * - Fewer bugs from state synchronization
 * - Better performance (fewer re-renders)
 * - Easier to test individual functions
 */

