import { configureStore } from '@reduxjs/toolkit';
import libraryReducer from './slices/librarySlice';
import readerReducer from './slices/readerSlice';
import audioReducer from './slices/audioSlice';
import settingsReducer from './slices/settingsSlice';

export const store = configureStore({
  reducer: {
    library: libraryReducer,
    reader: readerReducer,
    audio: audioReducer,
    settings: settingsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
