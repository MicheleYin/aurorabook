import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { Chapter } from '../../types/reader';

interface ReaderState {
  currentBookId: string | null;
  currentChapterId: string | null;
  currentChapter: Chapter | null;
  scrollPosition: number | null;
  isLoading: boolean;
}

const initialState: ReaderState = {
  currentBookId: null,
  currentChapterId: null,
  currentChapter: null,
  scrollPosition: null,
  isLoading: false,
};

const readerSlice = createSlice({
  name: 'reader',
  initialState,
  reducers: {
    setCurrentBook: (state, action: PayloadAction<string | null>) => {
      state.currentBookId = action.payload;
      // Reset chapter when book changes
      if (action.payload !== state.currentBookId) {
        state.currentChapterId = null;
        state.currentChapter = null;
        state.scrollPosition = null;
      }
    },
    setCurrentChapter: (state, action: PayloadAction<string | null>) => {
      state.currentChapterId = action.payload;
      // Reset chapter data when chapter ID changes
      if (action.payload !== state.currentChapterId) {
        state.currentChapter = null;
        state.scrollPosition = null;
      }
    },
    setCurrentChapterData: (state, action: PayloadAction<Chapter | null>) => {
      state.currentChapter = action.payload;
      state.isLoading = false;
    },
    setScrollPosition: (state, action: PayloadAction<number | null>) => {
      state.scrollPosition = action.payload;
    },
    setIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    resetReader: () => initialState,
  },
});

export const {
  setCurrentBook,
  setCurrentChapter,
  setCurrentChapterData,
  setScrollPosition,
  setIsLoading,
  resetReader,
} = readerSlice.actions;

export default readerSlice.reducer;
