import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectCurrentBook, selectCurrentChapter, selectScrollPosition, selectLibrary } from '../store/selectors';
import { setCurrentBook as setCurrentBookAction, setCurrentChapter, setScrollPosition, setCurrentChapterData, setIsLoading } from '../store/slices/readerSlice';
import { loadProgressChapter } from '../store/thunks/readerThunks';
import { updateBookProgress } from '../store/thunks/libraryThunks';
import { store } from '../store';
import { logger } from '../lib/logger';

/**
 * Simplified reader hook
 */
export function useReader() {
  const dispatch = useAppDispatch();
  const currentBook = useAppSelector(selectCurrentBook);
  const currentChapter = useAppSelector(selectCurrentChapter);
  const scrollPosition = useAppSelector(selectScrollPosition);
  const library = useAppSelector(selectLibrary);

  const openBook = useCallback(async (bookId: string) => {
    dispatch(setCurrentBookAction(bookId));
    
    // Auto-load last chapter from book progress
    const book = library.find((b) => b.id === bookId);
    if (book?.progress?.currentChapterId) {
      await dispatch(loadProgressChapter({ 
        bookId, 
        chapterId: book.progress.currentChapterId 
      })).unwrap();
      if (book.progress.currentChapterScrollTop) {
        dispatch(setScrollPosition(book.progress.currentChapterScrollTop));
      }
    }
  }, [dispatch, library]);

  const openChapter = useCallback(async (chapterId: string) => {
    if (!currentBook) {
      logger.warn('[useReader] Cannot open chapter - no book selected');
      return;
    }
    
    dispatch(setIsLoading(true));
    try {
      await dispatch(loadProgressChapter({ 
        bookId: currentBook.id, 
        chapterId 
      })).unwrap();
    } finally {
      dispatch(setIsLoading(false));
    }
  }, [dispatch, currentBook]);

  const saveScrollPosition = useCallback((position: number) => {
    if (!currentBook || !currentChapter) return;
    
    dispatch(setScrollPosition(position));
    
    // Save to backend (simple debounce in component)
    // updateBookProgress will calculate the full progress object
    dispatch(updateBookProgress({
      bookId: currentBook.id,
      progress: {
        chapterId: currentChapter.id,
        scrollTop: position,
        updatedAt: new Date().toISOString(),
      },
    }));
  }, [dispatch, currentBook, currentChapter]);

  return {
    currentBook,
    currentChapter,
    scrollPosition,
    openBook,
    openChapter,
    saveScrollPosition,
  };
}

