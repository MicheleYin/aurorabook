import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { ConversionProgress } from '../../lib/audiobook-converter';
import type { Book } from '../../types/reader';

export type PendingBookForConversion = {
  book: Book;
  buffer: ArrayBuffer;
};

interface ConversionState {
  showDialog: boolean;
  pendingBook: PendingBookForConversion | null;
  isConverting: boolean;
  currentProgress: ConversionProgress | null;
  bookProgress: Record<string, ConversionProgress>;
  isCancelling: boolean;
  cancellingBookId: string | null;
  convertingBookId: string | null;
  convertingSourcePath: string | null;
  conversionStartTime: number | null;
}

const initialState: ConversionState = {
  showDialog: false,
  pendingBook: null,
  isConverting: false,
  currentProgress: null,
  bookProgress: {},
  isCancelling: false,
  cancellingBookId: null,
  convertingBookId: null,
  convertingSourcePath: null,
  conversionStartTime: null,
};

const conversionSlice = createSlice({
  name: 'conversion',
  initialState,
  reducers: {
    setShowDialog: (state, action: PayloadAction<boolean>) => {
      state.showDialog = action.payload;
    },
    setPendingBook: (state, action: PayloadAction<PendingBookForConversion | null>) => {
      state.pendingBook = action.payload;
    },
    setIsConverting: (state, action: PayloadAction<boolean>) => {
      state.isConverting = action.payload;
    },
    setCurrentProgress: (state, action: PayloadAction<ConversionProgress | null>) => {
      state.currentProgress = action.payload;
    },
    setBookProgress: (state, action: PayloadAction<{ bookId: string; progress: ConversionProgress | null }>) => {
      if (action.payload.progress === null) {
        const { [action.payload.bookId]: _, ...rest } = state.bookProgress;
        state.bookProgress = rest;
      } else {
        state.bookProgress[action.payload.bookId] = action.payload.progress;
      }
    },
    setIsCancelling: (state, action: PayloadAction<boolean>) => {
      state.isCancelling = action.payload;
    },
    setCancellingBookId: (state, action: PayloadAction<string | null>) => {
      state.cancellingBookId = action.payload;
    },
    setConvertingBookId: (state, action: PayloadAction<string | null>) => {
      state.convertingBookId = action.payload;
    },
    setConvertingSourcePath: (state, action: PayloadAction<string | null>) => {
      state.convertingSourcePath = action.payload;
    },
    setConversionStartTime: (state, action: PayloadAction<number | null>) => {
      state.conversionStartTime = action.payload;
    },
    resetConversion: (state) => {
      state.isConverting = false;
      state.currentProgress = null;
      state.isCancelling = false;
      state.cancellingBookId = null;
      state.convertingBookId = null;
      state.convertingSourcePath = null;
      state.conversionStartTime = null;
    },
  },
});

export const {
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
  resetConversion,
} = conversionSlice.actions;

export default conversionSlice.reducer;

