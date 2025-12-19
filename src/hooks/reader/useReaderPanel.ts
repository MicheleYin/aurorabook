/**
 * Custom hook for ReaderPanel that provides clean Redux integration
 * Prevents infinite loops by using stable selectors and refs
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
import {
  selectReaderUISettingsOpen,
  selectReaderUITocOpen,
  selectReaderUIImmersive,
  selectReaderUIAudioReopenVisible,
  selectReaderUIShouldRenderAudioReopen,
  selectReaderUIPreserveChromeNextSelection,
  selectCurrentBookId,
  selectCurrentChapterId,
} from '../../store/selectors';
import {
  setReaderUISettingsOpen,
  setReaderUITocOpen,
  setReaderUIImmersive,
  setReaderUIAudioReopenVisible,
  setReaderUIShouldRenderAudioReopen,
  setReaderUIPreserveChromeNextSelection,
} from '../../store/slices/readerSlice';
import type { Book, Chapter } from '../../types/reader';

export interface UseReaderPanelParams {
  activeBook: Book | undefined;
  activeChapter: Chapter | undefined;
  audioPlayerVisible?: boolean;
  onOpenAudioPlayer?: () => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
}

export interface UseReaderPanelReturn {
  // UI state
  isSettingsOpen: boolean;
  isTocOpen: boolean;
  isImmersive: boolean;
  isAudioReopenVisible: boolean;
  shouldRenderAudioReopen: boolean;
  chromeVisible: boolean;
  
  // Actions
  openSettings: () => void;
  closeSettings: () => void;
  toggleSettings: () => void;
  openToc: () => void;
  closeToc: () => void;
  toggleToc: () => void;
  toggleImmersive: () => void;
  handleChapterChange: (chapterId: string, options?: { preserveChrome?: boolean }) => void;
  
  // Audio reopen button
  showAudioReopen: boolean;
}

export function useReaderPanel({
  activeBook,
  activeChapter,
  audioPlayerVisible,
  onOpenAudioPlayer,
  onChromeVisibilityChange,
}: UseReaderPanelParams): UseReaderPanelReturn {
  const dispatch = useAppDispatch();
  
  // Get UI state from Redux - these are stable selectors
  const isSettingsOpen = useAppSelector(selectReaderUISettingsOpen);
  const isTocOpen = useAppSelector(selectReaderUITocOpen);
  const isImmersive = useAppSelector(selectReaderUIImmersive);
  const isAudioReopenVisible = useAppSelector(selectReaderUIAudioReopenVisible);
  const shouldRenderAudioReopen = useAppSelector(selectReaderUIShouldRenderAudioReopen);
  const preserveChromeNextSelection = useAppSelector(selectReaderUIPreserveChromeNextSelection);
  
  // Get current book/chapter IDs for change detection
  const currentBookId = useAppSelector(selectCurrentBookId);
  const currentChapterId = useAppSelector(selectCurrentChapterId);
  
  // Track previous values to detect changes
  const previousBookIdRef = useRef<string | undefined>(currentBookId ?? undefined);
  const previousChapterIdRef = useRef<string | undefined>(currentChapterId ?? undefined);
  
  // Derived state
  const chromeVisible = !isImmersive;
  
  // Notify parent of chrome visibility changes - use ref to prevent loops
  const chromeVisibleRef = useRef(chromeVisible);
  const onChromeVisibilityChangeRef = useRef(onChromeVisibilityChange);
  
  useEffect(() => {
    chromeVisibleRef.current = chromeVisible;
    onChromeVisibilityChangeRef.current = onChromeVisibilityChange;
  }, [chromeVisible, onChromeVisibilityChange]);
  
  useEffect(() => {
    // Only notify if value actually changed
    const prevVisible = chromeVisibleRef.current;
    if (prevVisible !== chromeVisible) {
      chromeVisibleRef.current = chromeVisible;
      onChromeVisibilityChangeRef.current?.(chromeVisible);
    }
  }, [chromeVisible]);
  
  // Reset UI state when book or chapter changes
  useEffect(() => {
    const bookChanged = previousBookIdRef.current !== currentBookId;
    const chapterChanged = previousChapterIdRef.current !== currentChapterId;
    
    if (bookChanged || chapterChanged) {
      // Update refs
      previousBookIdRef.current = currentBookId ?? undefined;
      previousChapterIdRef.current = currentChapterId ?? undefined;
      
      // Close TOC when book/chapter changes
      if (isTocOpen) {
        dispatch(setReaderUITocOpen(false));
      }
      
      // Reset immersive mode unless preserveChromeNextSelection is set
      if (!preserveChromeNextSelection && isImmersive) {
        dispatch(setReaderUIImmersive(false));
      }
      
      // Clear preserveChromeNextSelection flag if it was set
      if (preserveChromeNextSelection) {
        dispatch(setReaderUIPreserveChromeNextSelection(false));
      }
    }
  }, [currentBookId, currentChapterId, isTocOpen, isImmersive, preserveChromeNextSelection, dispatch]);
  
  // Audio reopen button logic
  const audioTracks = activeBook?.audioTracks ?? [];
  const hasAudioTracks = audioTracks.length > 0;
  const showAudioPlayer = audioPlayerVisible ?? hasAudioTracks;
  const showAudioReopen = Boolean(hasAudioTracks && !showAudioPlayer && onOpenAudioPlayer);
  
  // Handle audio reopen button animation - use refs to prevent loops
  const showAudioReopenRef = useRef(showAudioReopen);
  const shouldRenderAudioReopenRef = useRef(shouldRenderAudioReopen);
  
  useEffect(() => {
    showAudioReopenRef.current = showAudioReopen;
    shouldRenderAudioReopenRef.current = shouldRenderAudioReopen;
  }, [showAudioReopen, shouldRenderAudioReopen]);
  
  useEffect(() => {
    // Only dispatch if state needs to change
    if (showAudioReopen && !shouldRenderAudioReopen) {
      dispatch(setReaderUIShouldRenderAudioReopen(true));
      // Small delay to trigger enter animation
      const timer = setTimeout(() => {
        dispatch(setReaderUIAudioReopenVisible(true));
      }, 10);
      return () => clearTimeout(timer);
    } else if (!showAudioReopen && shouldRenderAudioReopen) {
      // Trigger exit animation before hiding
      dispatch(setReaderUIAudioReopenVisible(false));
      // Wait for exit animation to complete before removing from DOM
      const timer = setTimeout(() => {
        dispatch(setReaderUIShouldRenderAudioReopen(false));
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [dispatch, showAudioReopen, shouldRenderAudioReopen]);
  
  // Actions
  const openSettings = useCallback(() => {
    dispatch(setReaderUISettingsOpen(true));
    dispatch(setReaderUIImmersive(false));
  }, [dispatch]);
  
  const closeSettings = useCallback(() => {
    dispatch(setReaderUISettingsOpen(false));
  }, [dispatch]);
  
  const toggleSettings = useCallback(() => {
    if (isSettingsOpen) {
      closeSettings();
    } else {
      openSettings();
    }
  }, [isSettingsOpen, openSettings, closeSettings]);
  
  const openToc = useCallback(() => {
    dispatch(setReaderUITocOpen(true));
    dispatch(setReaderUIImmersive(false));
  }, [dispatch]);
  
  const closeToc = useCallback(() => {
    dispatch(setReaderUITocOpen(false));
  }, [dispatch]);
  
  const toggleToc = useCallback(() => {
    if (isTocOpen) {
      closeToc();
    } else {
      openToc();
    }
  }, [isTocOpen, openToc, closeToc]);
  
  const toggleImmersive = useCallback(() => {
    const newImmersive = !isImmersive;
    dispatch(setReaderUIImmersive(newImmersive));
    if (newImmersive) {
      dispatch(setReaderUISettingsOpen(false));
      dispatch(setReaderUITocOpen(false));
    }
  }, [dispatch, isImmersive]);
  
  const handleChapterChange = useCallback((chapterId: string, options?: { preserveChrome?: boolean }) => {
    if (options?.preserveChrome) {
      dispatch(setReaderUIPreserveChromeNextSelection(true));
    }
  }, [dispatch]);
  
  return {
    isSettingsOpen,
    isTocOpen,
    isImmersive,
    isAudioReopenVisible,
    shouldRenderAudioReopen,
    chromeVisible,
    openSettings,
    closeSettings,
    toggleSettings,
    openToc,
    closeToc,
    toggleToc,
    toggleImmersive,
    handleChapterChange,
    showAudioReopen,
  };
}

