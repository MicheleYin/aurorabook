import { createAsyncThunk } from '@reduxjs/toolkit';
import { toast } from 'sonner';
import { listen } from '@tauri-apps/api/event';
import { logger } from '../../lib/logger';
import { mergeBookAudioFields } from '../../lib/book-utils';
import type { Book, VoiceId } from '../../types/reader';
// Types imported but not used directly in thunks
import { convertEpubToAudiobook } from '../../lib/audiobook-converter';
import { readAllBooks, readOneBook } from '../../lib/book-service';
import { clearBookCache, clearChapterCache } from '../../lib/lazy-chapter-loader';
import type { RootState, AppDispatch } from '../index';
import {
  setShowDialog,
  setPendingBook,
  setIsConverting,
  setCurrentProgress,
  setBookProgress,
  setIsCancelling,
  setCancellingBookId,
  setConvertingBookId,
  setConvertingSourcePath,
  setConversionStartTime,
} from '../slices/conversionSlice';
import { addBook, updateBook } from '../slices/librarySlice';

// Track if listeners are already set up
let listenersSetup = false;

/**
 * Set up event listeners for conversion progress and cancellation
 * This should be called once on app initialization
 */
export const setupConversionListeners = createAsyncThunk<
  void,
  void,
  { state: RootState; dispatch: AppDispatch }
>(
  'conversion/setupListeners',
  async (_, { dispatch, getState }) => {
    if (listenersSetup) return;
    listenersSetup = true;
    // Listen for chapter completion events
    await listen<{
      source_path: string;
      chapter_index: number;
      total_chapters: number;
      chapter_title: string;
      audio_generated: boolean;
    }>('chapter-completed', async (event) => {
      const { source_path, chapter_title, audio_generated, chapter_index } = event.payload;
      
      logger.log('[Conversion] 📥 Received chapter-completed event', {
        source_path,
        chapter_index,
        chapter_title,
        audio_generated,
      });
      
      try {
        const state = getState();
        let existingBook = state.library.books.find(
          (book) => book.sourcePath === source_path
        );
        
        if (!existingBook) {
          logger.debug('Book not in library state, fetching from backend', { source_path });
          const allBooks = await readAllBooks();
          existingBook = allBooks.find(
            (book) => book.sourcePath === source_path
          );
        }
        
        if (!existingBook) {
          logger.warn('Book not found in library for source_path:', source_path);
          return;
        }
        
        const updatedBook = await readOneBook(existingBook.id);
        if (!updatedBook) {
          logger.warn('Failed to fetch updated book:', existingBook.id);
          return;
        }
        
        // Clear cache for completed chapter
        const completedChapterIndex = chapter_index - 1;
        let completedChapter: typeof updatedBook.chapters[0] | null = null;
        
        if (completedChapterIndex >= 0 && completedChapterIndex < updatedBook.chapters.length) {
          completedChapter = updatedBook.chapters[completedChapterIndex];
          clearChapterCache(source_path, completedChapter.href);
        } else {
          clearBookCache(source_path);
        }
        
        // Merge audio fields into existing book
        const mergedBook = mergeBookAudioFields(existingBook, updatedBook);
        dispatch(updateBook({ bookId: mergedBook.id, updates: mergedBook }));
        
        // Emit chapter-updated event
        if (completedChapter) {
          const chapterUpdatedEvent = new CustomEvent('chapter-updated', {
            detail: {
              bookId: existingBook.id,
              sourcePath: source_path,
              chapterId: completedChapter.id,
              chapterHref: completedChapter.href,
              chapterIndex: chapter_index,
            },
          });
          window.dispatchEvent(chapterUpdatedEvent);
        }
        
        if (audio_generated) {
          toast.info('New chapter available', {
            description: `"${chapter_title}" has been converted and is ready to play.`,
            duration: 5000,
          });
        }
      } catch (error) {
        logger.warn('Failed to refresh book after chapter completion:', error);
      }
    });
    
    // Listen for conversion cancellation events
    await listen<{
      source_path: string;
    }>('conversion-cancelled', async (event) => {
      const { source_path } = event.payload;
      
      try {
        const state = getState();
        let existingBook = state.library.books.find(
          (book) => book.sourcePath === source_path
        );
        
        if (!existingBook) {
          const allBooks = await readAllBooks();
          existingBook = allBooks.find(
            (book) => book.sourcePath === source_path
          );
        }
        
        if (!existingBook) {
          logger.warn('Book not found in library for source_path:', source_path);
          return;
        }
        
        const updatedBook = await readOneBook(existingBook.id);
        if (!updatedBook) {
          logger.warn('Failed to fetch updated book:', existingBook.id);
          return;
        }
        
        const mergedBook = mergeBookAudioFields(existingBook, updatedBook);
        dispatch(updateBook({ bookId: mergedBook.id, updates: mergedBook }));
        
        dispatch(setIsCancelling(false));
        dispatch(setCancellingBookId(null));
        dispatch(setCurrentProgress(null));
        dispatch(setBookProgress({ bookId: existingBook.id, progress: null }));
        
        toast.info('Conversion cancelled', {
          description: 'The conversion has been cancelled.',
        });
      } catch (error) {
        logger.warn('Failed to refresh book after conversion cancellation:', error);
        dispatch(setIsCancelling(false));
        dispatch(setCancellingBookId(null));
      }
    });
    
    // Store cleanup functions (would need to be handled differently in real implementation)
    // For now, listeners stay active for the app lifetime
  }
);

/**
 * Convert a book to audiobook
 */
export const convertBook = createAsyncThunk<
  void,
  { book: Book; voiceId: VoiceId; closeDialog?: boolean },
  { state: RootState; dispatch: AppDispatch }
>(
  'conversion/convertBook',
  async ({ book, voiceId, closeDialog }, { dispatch, getState, rejectWithValue }) => {
    const abortController = new AbortController();
    
    dispatch(setConvertingBookId(book.id));
    dispatch(setConvertingSourcePath(book.sourcePath));
    dispatch(setIsConverting(true));
    if (closeDialog) {
      dispatch(setShowDialog(false));
    }
    dispatch(setCurrentProgress({
      currentChapter: 0,
      totalChapters: 0,
      wordsProcessed: 0,
      totalWords: 0,
      wordsInCurrentChapter: 0,
      currentStep: 'initializing',
      message: 'Starting conversion...',
    }));
    dispatch(setConversionStartTime(Date.now()));
    
    let wasCancelled = false;
    
    try {
      const updatedBook = await convertEpubToAudiobook({
        bookId: book.id,
        voiceId,
        signal: abortController.signal,
        onProgress: (progress) => {
          dispatch(setCurrentProgress(progress));
          dispatch(setBookProgress({ bookId: book.id, progress }));
        },
      });
      
      clearBookCache(book.sourcePath);
      
      if (updatedBook) {
        const state = getState();
        const existingBook = state.library.books.find((b) => b.id === updatedBook.id);
        if (existingBook) {
          dispatch(updateBook({ bookId: updatedBook.id, updates: updatedBook }));
        } else {
          dispatch(addBook(updatedBook));
        }
      }
      
      dispatch(setCurrentProgress(null));
      dispatch(setBookProgress({ bookId: book.id, progress: null }));
      toast.success('Audiobook ready!', {
        description: 'Your ebook has been converted to an audiobook.',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'Conversion cancelled') {
        wasCancelled = true;
      } else {
        logger.error('Conversion error:', error);
        toast.error('Conversion failed', {
          description: error instanceof Error ? error.message : 'An error occurred during conversion',
        });
        dispatch(setIsCancelling(false));
        dispatch(setCancellingBookId(null));
      }
      dispatch(setCurrentProgress(null));
      dispatch(setBookProgress({ bookId: book.id, progress: null }));
      return rejectWithValue(error);
    } finally {
      dispatch(setIsConverting(false));
      dispatch(setConvertingBookId(null));
      dispatch(setConvertingSourcePath(null));
      dispatch(setConversionStartTime(null));
      if (!wasCancelled) {
        dispatch(setIsCancelling(false));
        dispatch(setCancellingBookId(null));
      }
    }
  }
);

/**
 * Cancel conversion for a book
 */
export const cancelConversion = createAsyncThunk<
  void,
  { bookId: string },
  { state: RootState; dispatch: AppDispatch }
>(
  'conversion/cancelConversion',
  async ({ bookId }, { dispatch, getState, rejectWithValue }) => {
    dispatch(setIsCancelling(true));
    dispatch(setCancellingBookId(bookId));
    
    const state = getState();
    const sourcePath = state.conversion.convertingSourcePath;
    
    if (sourcePath) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('cancel_conversion_command', { sourcePath });
      } catch (error) {
        logger.error('Failed to cancel conversion on backend:', error);
        dispatch(setIsCancelling(false));
        dispatch(setCancellingBookId(null));
        return rejectWithValue(error);
      }
    } else {
      dispatch(setIsCancelling(false));
      dispatch(setCancellingBookId(null));
    }
    
    dispatch(setIsConverting(false));
    dispatch(setConvertingBookId(null));
    dispatch(setConvertingSourcePath(null));
    dispatch(setConversionStartTime(null));
    
    if (state.conversion.pendingBook?.book.id === bookId) {
      dispatch(setPendingBook(null));
      dispatch(setShowDialog(false));
    }
  }
);

