import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Book } from '../../types/reader';

interface LibraryState {
  books: Book[];
  isHydrated: boolean;
  isImporting: boolean;
}

const initialState: LibraryState = {
  books: [],
  isHydrated: false,
  isImporting: false,
};

const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    setLibrary: (state, action: PayloadAction<Book[]>) => {
      state.books = action.payload;
    },
    addBook: (state, action: PayloadAction<Book>) => {
      const existingIndex = state.books.findIndex(
        (b) => b.id === action.payload.id || b.sourcePath === action.payload.sourcePath
      );
      if (existingIndex !== -1) {
        state.books[existingIndex] = action.payload;
      } else {
        state.books.push(action.payload);
      }
    },
    updateBook: (state, action: PayloadAction<{ bookId: string; updates: Partial<Book> }>) => {
      const index = state.books.findIndex((b) => b.id === action.payload.bookId);
      if (index !== -1) {
        const book = state.books[index];
        const updates = action.payload.updates;
        
        // Handle deep updates for chapters array
        if (updates.chapters) {
          state.books[index] = {
            ...book,
            ...updates,
            chapters: updates.chapters,
          };
        }
        // Handle deep updates for audioTracks array
        else if (updates.audioTracks) {
          state.books[index] = {
            ...book,
            ...updates,
            audioTracks: updates.audioTracks,
          };
        }
        // Handle updates to progress or audioState (which are objects)
        else if (updates.progress || updates.audioState) {
          state.books[index] = {
            ...book,
            ...updates,
            progress: updates.progress ?? book.progress,
            audioState: updates.audioState ?? book.audioState,
          };
        }
        // Shallow merge for other updates
        else {
          state.books[index] = { ...book, ...updates };
        }
      }
    },
    removeBook: (state, action: PayloadAction<string>) => {
      state.books = state.books.filter((b) => b.id !== action.payload);
    },
    setIsHydrated: (state, action: PayloadAction<boolean>) => {
      state.isHydrated = action.payload;
    },
    setIsImporting: (state, action: PayloadAction<boolean>) => {
      state.isImporting = action.payload;
    },
  },
});

export const {
  setLibrary,
  addBook,
  updateBook,
  removeBook,
  setIsHydrated,
  setIsImporting,
} = librarySlice.actions;

export default librarySlice.reducer;

