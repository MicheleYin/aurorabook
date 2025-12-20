import { createAsyncThunk } from '@reduxjs/toolkit';
import { toast } from 'sonner';
import { open } from '@tauri-apps/plugin-dialog';
import { logger } from '../../lib/logger';
import { isIOS } from '../../lib/is-tauri';
import { readAllBooks, addBook as addBookToBackend } from '../../lib/book-service';
import type { Book } from '../../types/reader';
import type { RootState, AppDispatch } from '../index';
import { setLibrary, setIsImporting, addBook, updateBook } from '../slices/librarySlice';
import { applyDerivedFields, normalizeBookProgressShape, getNumberValue, getPercentValue } from '../../hooks/library/libraryHelpers';

export type IngestParams = {
  filePath: string;
  sourcePath: string;
  progress?: Book['progress'];
  pageCountHint?: number;
  audioState?: Book['audioState'];
};

/**
 * Refresh library from backend
 */
export const refreshLibrary = createAsyncThunk<
  Book[],
  void,
  { state: RootState; dispatch: AppDispatch }
>(
  'library/refreshLibrary',
  async (_, { getState, dispatch }) => {
    try {
      const books = await readAllBooks();
      const currentLibrary = getState().library.books;
      
      // Merge with existing library to preserve in-memory updates
      const backendBooksMap = new Map<string, Book>();
      books.forEach((book) => {
        backendBooksMap.set(book.id, book);
        backendBooksMap.set(book.sourcePath, book);
      });
      
      const mergedBooks: Book[] = [];
      const processedIds = new Set<string>();
      const processedPaths = new Set<string>();
      
      books.forEach((book) => {
        mergedBooks.push(book);
        processedIds.add(book.id);
        processedPaths.add(book.sourcePath);
      });
      
      currentLibrary.forEach((book) => {
        if (
          !processedIds.has(book.id) &&
          !processedPaths.has(book.sourcePath)
        ) {
          mergedBooks.push(book);
          processedIds.add(book.id);
          processedPaths.add(book.sourcePath);
        }
      });
      
      dispatch(setLibrary(mergedBooks));
      return mergedBooks;
    } catch (error) {
      logger.warn('Failed to load books from Rust backend.', error);
      throw error;
    }
  }
);

/**
 * Ingest EPUB file
 */
export const ingestEpub = createAsyncThunk<
  Book,
  IngestParams,
  { state: RootState; dispatch: AppDispatch }
>(
  'library/ingestEpub',
  async (params, { dispatch }) => {
    const { filePath, sourcePath, progress: savedProgress, pageCountHint, audioState: savedAudioState } = params;
    const { ingestEpub: ingestEpubCommand } = await import('../../lib/book-service');
    let book = await ingestEpubCommand(filePath, sourcePath);
    
    if (savedProgress && book.chapters.length) {
      const maxIndex = book.chapters.length - 1;
      const storedIndex =
        typeof savedProgress.currentChapterIndex === 'number'
          ? savedProgress.currentChapterIndex
          : 0;
      const normalizedIndex = Math.min(Math.max(storedIndex, 0), maxIndex);
      const candidateByHref = savedProgress.currentChapterHref
        ? book.chapters.find(
            (chapter) =>
              chapter.href === savedProgress.currentChapterHref ||
              chapter.href.split('#')[0] ===
                savedProgress.currentChapterHref.split('#')[0],
          )
        : undefined;
      const resolvedChapter =
        candidateByHref ??
        book.chapters[normalizedIndex] ??
        book.chapters[Math.min(normalizedIndex, maxIndex)];
      
      if (resolvedChapter) {
        const resolvedIndex = book.chapters.findIndex(
          (chapter) => chapter.id === resolvedChapter.id,
        );
        const chapterIndex = resolvedIndex === -1 ? 0 : resolvedIndex;
        
        const storedScrollTop = getNumberValue(
          savedProgress.currentChapterScrollTop,
          0,
        );
        const storedScrollHeight = getNumberValue(
          savedProgress.currentChapterScrollHeight,
          0,
        );
        const storedClientHeight = getNumberValue(
          savedProgress.currentChapterClientHeight,
          0,
        );
        
        let percentSource = getPercentValue(
          savedProgress.chapterProgressPercent,
          0,
        );
        
        if (
          (percentSource === undefined || percentSource === 0) &&
          storedScrollHeight > 0 &&
          storedClientHeight >= 0 &&
          storedScrollTop > 0
        ) {
          const savedMaxScroll = Math.max(
            storedScrollHeight - storedClientHeight,
            0,
          );
          if (savedMaxScroll > 0) {
            percentSource = Math.min(
              Math.max(storedScrollTop / savedMaxScroll, 0),
              1,
            );
          }
        }
        
        if (percentSource === undefined) {
          percentSource = 0;
        }
        
        const chapterProgressPercent = getPercentValue(percentSource, 0);
        const totalChapters = book.chapters.length;
        const bookProgressPercent = totalChapters > 0
          ? Math.min(Math.max((chapterIndex + chapterProgressPercent) / totalChapters, 0), 1)
          : 0;
        
        book = {
          ...book,
          progress: {
            currentChapterId: resolvedChapter.id,
            currentChapterHref: resolvedChapter.href,
            currentChapterIndex: chapterIndex,
            currentChapterScrollTop: storedScrollTop,
            currentChapterScrollHeight: storedScrollHeight,
            currentChapterClientHeight: storedClientHeight,
            chapterProgressPercent,
            bookProgressPercent,
            updatedAt: savedProgress.updatedAt ?? new Date().toISOString(),
          },
        };
      }
    }
    
    if (savedAudioState && book.audioTracks.length) {
      const resolvedTrack =
        book.audioTracks.find(
          (track) => track.href === savedAudioState.currentTrackHref,
        ) ??
        book.audioTracks[savedAudioState.currentTrackIndex] ??
        book.audioTracks.find(
          (track) => track.id === savedAudioState.currentTrackId,
        );
      if (resolvedTrack) {
        const resolvedIndex = book.audioTracks.findIndex(
          (track) => track.id === resolvedTrack.id,
        );
        const normalizedSeconds = getNumberValue(
          savedAudioState.currentTimeSeconds,
          0,
        );
        book = {
          ...book,
          audioState: {
            currentTrackId: resolvedTrack.id,
            currentTrackHref: resolvedTrack.href,
            currentTrackIndex: resolvedIndex === -1 ? 0 : resolvedIndex,
            currentTimeSeconds: Number(normalizedSeconds.toFixed(3)),
            updatedAt:
              savedAudioState.updatedAt ?? new Date().toISOString(),
          },
        };
      }
    }
    
    if (
      pageCountHint &&
      typeof pageCountHint === 'number' &&
      Number.isFinite(pageCountHint) &&
      pageCountHint > 0
    ) {
      book = {
        ...book,
        pageCount: Math.max(1, Math.round(pageCountHint)),
      };
    }
    
    const normalizedBook = normalizeBookProgressShape(
      applyDerivedFields(book),
    );
    
    if (
      normalizedBook.progress ||
      normalizedBook.audioState ||
      normalizedBook.pageCount
    ) {
      try {
        await addBookToBackend(normalizedBook, undefined);
      } catch (error) {
        logger.warn('Failed to update book with restored state', error);
      }
    }
    
    // Add book to Redux library (if not already present)
    const state = getState();
    const existingBook = state.library.books.find(
      (b) => b.id === normalizedBook.id || b.sourcePath === normalizedBook.sourcePath
    );
    
    if (!existingBook) {
      dispatch(addBook(normalizedBook));
    } else {
      // Update existing book if needed
      dispatch(updateBook({ bookId: normalizedBook.id, updates: normalizedBook }));
    }
    
    return normalizedBook;
  }
);

/**
 * Import EPUB from file dialog
 */
export const importFromDialog = createAsyncThunk<
  boolean | { book: Book; buffer: ArrayBuffer },
  void,
  { state: RootState; dispatch: AppDispatch }
>(
  'library/importFromDialog',
  async (_, { dispatch, getState, rejectWithValue }) => {
    const state = getState();
    if (state.library.isImporting) return false;
    
    try {
      dispatch(setIsImporting(true));
      
      const dialogOptions: Parameters<typeof open>[0] = isIOS()
        ? { multiple: false }
        : {
            multiple: false,
            filters: [{ name: 'EPUB files', extensions: ['epub'] }],
          };
      
      const selection = await open(dialogOptions);
      const filePath = Array.isArray(selection)
        ? selection[0]
        : selection ?? undefined;
      
      if (!filePath) return true;
      
      if (!filePath.toLowerCase().endsWith('.epub')) {
        toast.error('Please choose an EPUB (.epub) file.');
        return true;
      }
      
      const book = await dispatch(ingestEpub({
        filePath: filePath,
        sourcePath: filePath,
      })).unwrap();
      
      if (!book) {
        return true;
      }
      
      const currentLibrary = getState().library.books;
      const existingIndex = currentLibrary.findIndex(
        (b) => b.id === book.id 
          || b.sourcePath === book.sourcePath
          || (book.contentHash && b.contentHash && b.contentHash === book.contentHash),
      );
      
      if (existingIndex !== -1) {
        dispatch(updateBook({ bookId: book.id, updates: book }));
      } else {
        dispatch(addBook(book));
      }
      
      // Refresh library after adding
      requestAnimationFrame(() => {
        dispatch(refreshLibrary()).catch((error) => {
          logger.warn('Failed to refresh library after adding book:', error);
        });
      });
      
      const { getEpubBuffer } = await import('../../lib/book-service');
      const buffer = (await getEpubBuffer(filePath)) ?? new ArrayBuffer(0);
      return { book, buffer };
    } catch (error) {
      let errorMessage = 'Something went wrong while importing that ebook.';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && typeof error === 'object') {
        if ('message' in error) {
          errorMessage = String(error.message);
        } else if ('kind' in error) {
          const errorObj = error as { kind?: { message?: unknown } };
          if (errorObj.kind && 'message' in errorObj.kind) {
            errorMessage = String(errorObj.kind.message);
          }
        }
      }
      
      logger.error('Import error:', { error, errorMessage, errorString: String(error) });
      
      const errorString = String(error).toLowerCase();
      const errorMessageLower = errorMessage.toLowerCase();
      const isDuplicateError = 
        errorMessageLower.includes('duplicate book') || 
        errorMessageLower.includes('already in your library') ||
        errorString.includes('duplicate book') ||
        errorString.includes('already in your library');
      
      if (isDuplicateError) {
        const titleMatch = errorMessage.match(/This EPUB is already in your library: "([^"]+)"/);
        const bookTitle = titleMatch ? titleMatch[1] : null;
        
        toast.warning('Duplicate EPUB detected', {
          description: bookTitle 
            ? `"${bookTitle}" is already in your library.`
            : 'This EPUB is already in your library.',
        });
      } else {
        toast.error('Import failed', {
          description: errorMessage,
        });
      }
      return rejectWithValue(error);
    } finally {
      dispatch(setIsImporting(false));
    }
  }
);

/**
 * Update book progress with debouncing
 */
export const updateBookProgress = createAsyncThunk<
  void,
  {
    bookId: string;
    progress: {
      chapterId: string;
      scrollTop?: number;
      scrollHeight?: number;
      clientHeight?: number;
      percent?: number;
      elementId?: string | null;
      elementIndex?: number | null;
      updatedAt?: string;
    };
  },
  { state: RootState; dispatch: AppDispatch }
>(
  'library/updateBookProgress',
  async ({ bookId, progress }, { getState, dispatch }) => {
    const state = getState();
    const book = state.library.books.find((b) => b.id === bookId);
    if (!book) {
      logger.warn('[updateBookProgress] Book not found', { bookId });
      return;
    }

    // Update local state immediately
    const { getNumberValue, getPercentValue, getElementId, getElementIndex } = await import('../../hooks/library/libraryHelpers');
    
    const currentChapter = book.chapters.find((c) => c.id === progress.chapterId);
    if (!currentChapter) {
      logger.warn('[updateBookProgress] Chapter not found', { bookId, chapterId: progress.chapterId });
      return;
    }

    const chapterIndex = book.chapters.findIndex((c) => c.id === progress.chapterId);
    const scrollTop = getNumberValue(progress.scrollTop, book.progress?.currentChapterScrollTop ?? 0);
    const scrollHeight = getNumberValue(progress.scrollHeight, book.progress?.currentChapterScrollHeight ?? 0);
    const clientHeight = getNumberValue(progress.clientHeight, book.progress?.currentChapterClientHeight ?? 0);
    const percent = getPercentValue(progress.percent, book.progress?.chapterProgressPercent ?? 0);
    const elementId = getElementId(progress.elementId);
    const elementIndex = getElementIndex(progress.elementIndex);

    const totalChapters = book.chapters.length;
    const bookProgressPercent = totalChapters > 0
      ? Math.min(Math.max((chapterIndex + percent) / totalChapters, 0), 1)
      : 0;

    const newProgress = {
      currentChapterId: progress.chapterId,
      currentChapterHref: currentChapter.href,
      currentChapterIndex: chapterIndex,
      currentChapterScrollTop: scrollTop,
      currentChapterScrollHeight: scrollHeight,
      currentChapterClientHeight: clientHeight,
      chapterProgressPercent: percent,
      bookProgressPercent,
      currentChapterElementId: elementId,
      currentChapterElementIndex: elementIndex,
      updatedAt: progress.updatedAt ?? new Date().toISOString(),
    };

    // Update Redux state
    dispatch(updateBook({ bookId, updates: { progress: newProgress } }));

    // Debounced backend sync will be handled by a middleware or separate thunk
  }
);

/**
 * Update book audio state with debouncing
 */
export const updateBookAudioState = createAsyncThunk<
  void,
  {
    bookId: string;
    audioState: {
      currentTimeSeconds: number;
      trackId?: string;
      trackHref?: string;
      trackIndex?: number;
      updatedAt?: string;
    };
  },
  { state: RootState; dispatch: AppDispatch }
>(
  'library/updateBookAudioState',
  async ({ bookId, audioState }, { getState, dispatch }) => {
    const state = getState();
    const book = state.library.books.find((b) => b.id === bookId);
    if (!book?.audioTracks.length) {
      logger.warn('[updateBookAudioState] Book or tracks not found', { bookId });
      return;
    }

    const resolvedTrack =
      book.audioTracks.find((track) => track.id === audioState.trackId) ??
      book.audioTracks.find((track) => track.href === audioState.trackHref) ??
      book.audioTracks[audioState.trackIndex ?? 0];

    if (!resolvedTrack) {
      logger.warn('[updateBookAudioState] Track not found', { bookId, audioState });
      return;
    }

    const resolvedIndex = book.audioTracks.findIndex(
      (track) => track.id === resolvedTrack.id,
    );
    const normalizedSeconds = Number(audioState.currentTimeSeconds.toFixed(3));
    const existing = book.audioState;

    // Skip if unchanged (within tolerance)
    if (
      existing &&
      existing.currentTrackId === resolvedTrack.id &&
      Math.abs(existing.currentTimeSeconds - normalizedSeconds) < 0.25
    ) {
      return;
    }

    const newAudioState = {
      currentTrackId: resolvedTrack.id,
      currentTrackHref: resolvedTrack.href,
      currentTrackIndex: resolvedIndex === -1 ? audioState.trackIndex ?? 0 : resolvedIndex,
      currentTimeSeconds: normalizedSeconds,
      updatedAt: audioState.updatedAt ?? new Date().toISOString(),
    };

    // Update Redux state
    dispatch(updateBook({ bookId, updates: { audioState: newAudioState } }));

    // Debounced backend sync will be handled by a middleware or separate thunk
  }
);

/**
 * Flush pending progress update to backend
 */
export const flushProgressUpdate = createAsyncThunk<
  void,
  { bookId: string },
  { state: RootState; dispatch: AppDispatch }
>(
  'library/flushProgressUpdate',
  async ({ bookId }, { getState, dispatch }) => {
    const state = getState();
    const book = state.library.books.find((b) => b.id === bookId);
    if (!book?.progress) {
      return;
    }

    try {
      const { updateBookProgress: updateBookProgressBackend } = await import('../../lib/book-service');
      const updatedBook = await updateBookProgressBackend(bookId, book.progress);
      dispatch(updateBook({ bookId, updates: updatedBook }));
    } catch (error) {
      logger.error('[flushProgressUpdate] Failed to sync progress to backend', { bookId, error });
      throw error;
    }
  }
);

/**
 * Flush pending audio state update to backend
 */
export const flushAudioStateUpdate = createAsyncThunk<
  void,
  { bookId: string },
  { state: RootState; dispatch: AppDispatch }
>(
  'library/flushAudioStateUpdate',
  async ({ bookId }, { getState, dispatch }) => {
    const state = getState();
    const book = state.library.books.find((b) => b.id === bookId);
    if (!book?.audioState) {
      return;
    }

    try {
      const { updateBookAudioState: updateBookAudioStateBackend } = await import('../../lib/book-service');
      const updatedBook = await updateBookAudioStateBackend(bookId, book.audioState);
      dispatch(updateBook({ bookId, updates: updatedBook }));
    } catch (error) {
      logger.error('[flushAudioStateUpdate] Failed to sync audio state to backend', { bookId, error });
      throw error;
    }
  }
);

