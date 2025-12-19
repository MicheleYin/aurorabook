import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export type OperationType =
  | 'changeChapter'
  | 'restoreChapter'
  | 'restoreChapterProgress'
  | 'saveChapter'
  | 'saveChapterProgress'
  | 'loadAudioTrack'
  | 'restoreAudioTimestamp'
  | 'saveAudioTrack'
  | 'saveAudioTimestamp'
  | 'changeAudioTrack';

export type OperationState = {
  type: OperationType;
  id: string;
  bookId?: string;
  chapterId?: string;
  trackId?: string;
  timestamp: number;
  cancelled: boolean;
};

interface ReaderCoordinatorState {
  locks: {
    chapter: OperationState | null;
    audio: OperationState | null;
    progress: OperationState | null;
  };
  loading: {
    chapterLoading: boolean;
    chapterRestoring: boolean;
    chapterSaving: boolean;
    audioLoading: boolean;
    audioRestoring: boolean;
    audioSaving: boolean;
    trackChanging: boolean;
  };
}

const initialState: ReaderCoordinatorState = {
  locks: {
    chapter: null,
    audio: null,
    progress: null,
  },
  loading: {
    chapterLoading: false,
    chapterRestoring: false,
    chapterSaving: false,
    audioLoading: false,
    audioRestoring: false,
    audioSaving: false,
    trackChanging: false,
  },
};

const readerCoordinatorSlice = createSlice({
  name: 'readerCoordinator',
  initialState,
  reducers: {
    setChapterLock: (state, action: PayloadAction<OperationState | null>) => {
      state.locks.chapter = action.payload;
    },
    setAudioLock: (state, action: PayloadAction<OperationState | null>) => {
      state.locks.audio = action.payload;
    },
    setProgressLock: (state, action: PayloadAction<OperationState | null>) => {
      state.locks.progress = action.payload;
    },
    cancelOperation: (state, action: PayloadAction<string>) => {
      const operationId = action.payload;
      if (state.locks.chapter?.id === operationId) {
        state.locks.chapter = { ...state.locks.chapter, cancelled: true };
      }
      if (state.locks.audio?.id === operationId) {
        state.locks.audio = { ...state.locks.audio, cancelled: true };
      }
      if (state.locks.progress?.id === operationId) {
        state.locks.progress = { ...state.locks.progress, cancelled: true };
      }
    },
    cancelAllOperations: (state) => {
      if (state.locks.chapter) {
        state.locks.chapter = { ...state.locks.chapter, cancelled: true };
      }
      if (state.locks.audio) {
        state.locks.audio = { ...state.locks.audio, cancelled: true };
      }
      if (state.locks.progress) {
        state.locks.progress = { ...state.locks.progress, cancelled: true };
      }
      state.locks = {
        chapter: null,
        audio: null,
        progress: null,
      };
      state.loading = {
        chapterLoading: false,
        chapterRestoring: false,
        chapterSaving: false,
        audioLoading: false,
        audioRestoring: false,
        audioSaving: false,
        trackChanging: false,
      };
    },
    setChapterLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.chapterLoading = action.payload;
    },
    setChapterRestoring: (state, action: PayloadAction<boolean>) => {
      state.loading.chapterRestoring = action.payload;
    },
    setChapterSaving: (state, action: PayloadAction<boolean>) => {
      state.loading.chapterSaving = action.payload;
    },
    setAudioLoading: (state, action: PayloadAction<boolean>) => {
      state.loading.audioLoading = action.payload;
    },
    setAudioRestoring: (state, action: PayloadAction<boolean>) => {
      state.loading.audioRestoring = action.payload;
    },
    setAudioSaving: (state, action: PayloadAction<boolean>) => {
      state.loading.audioSaving = action.payload;
    },
    setTrackChanging: (state, action: PayloadAction<boolean>) => {
      state.loading.trackChanging = action.payload;
    },
  },
});

export const {
  setChapterLock,
  setAudioLock,
  setProgressLock,
  cancelOperation,
  cancelAllOperations,
  setChapterLoading,
  setChapterRestoring,
  setChapterSaving,
  setAudioLoading,
  setAudioRestoring,
  setAudioSaving,
  setTrackChanging,
} = readerCoordinatorSlice.actions;

export default readerCoordinatorSlice.reducer;

