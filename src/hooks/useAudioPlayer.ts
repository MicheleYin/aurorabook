import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectCurrentTrack, selectTrackUrl, selectSeekPosition, selectIsPlaying, selectCurrentBook, selectLibrary } from '../store/selectors';
import { setCurrentTrack, setSeekPosition, setIsPlaying, setCurrentTrackData, setTrackUrl, setIsLoading } from '../store/slices/audioSlice';
import { loadProgressAudioTrack } from '../store/thunks/readerThunks';
import { updateBookAudioState } from '../store/thunks/libraryThunks';
import { logger } from '../lib/logger';

/**
 * Simplified audio player hook
 */
export function useAudioPlayer() {
  const dispatch = useAppDispatch();
  const currentTrack = useAppSelector(selectCurrentTrack);
  const trackUrl = useAppSelector(selectTrackUrl);
  const seekPosition = useAppSelector(selectSeekPosition);
  const isPlaying = useAppSelector(selectIsPlaying);
  const currentBook = useAppSelector(selectCurrentBook);
  const library = useAppSelector(selectLibrary);

  const openTrack = useCallback(async (bookId: string, trackId: string) => {
    dispatch(setCurrentTrack(trackId));
    dispatch(setIsLoading(true));
    
    try {
      const result = await dispatch(loadProgressAudioTrack({ bookId, trackId })).unwrap();
      if (result) {
        dispatch(setCurrentTrackData(result.track));
        dispatch(setTrackUrl(result.url));
      }
      
      // Restore seek position from book.audioState
      const book = library.find((b) => b.id === bookId);
      if (book?.audioState?.currentTimeSeconds) {
        dispatch(setSeekPosition(book.audioState.currentTimeSeconds));
      }
    } catch (error) {
      logger.error('[useAudioPlayer] Failed to load track', { bookId, trackId, error });
    } finally {
      dispatch(setIsLoading(false));
    }
  }, [dispatch, library]);

  const play = useCallback(() => {
    dispatch(setIsPlaying(true));
  }, [dispatch]);

  const pause = useCallback(() => {
    dispatch(setIsPlaying(false));
  }, [dispatch]);

  const seek = useCallback((position: number) => {
    dispatch(setSeekPosition(position));
    
    // Save to backend (simple debounce in component)
    if (currentBook && currentTrack) {
      dispatch(updateBookAudioState({
        bookId: currentBook.id,
        audioState: {
          trackId: currentTrack.id,
          trackHref: currentTrack.href,
          trackIndex: currentBook.audioTracks.findIndex(t => t.id === currentTrack.id),
          currentTimeSeconds: position,
          updatedAt: new Date().toISOString(),
        },
      }));
    }
  }, [dispatch, currentBook, currentTrack]);

  return {
    currentTrack,
    trackUrl,
    seekPosition,
    isPlaying,
    openTrack,
    play,
    pause,
    seek,
  };
}

