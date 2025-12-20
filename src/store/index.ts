import { configureStore } from '@reduxjs/toolkit';
import libraryReducer from './slices/librarySlice';
import navigationReducer from './slices/navigationSlice';
import readerReducer from './slices/readerSlice';
import conversionReducer from './slices/conversionSlice';
import readerCoordinatorReducer from './slices/readerCoordinatorSlice';
import uiReducer from './slices/uiSlice';
import { progressDebounceMiddleware } from './middleware/progressDebounceMiddleware';

export const store = configureStore({
  reducer: {
    library: libraryReducer,
    navigation: navigationReducer,
    reader: readerReducer,
    conversion: conversionReducer,
    readerCoordinator: readerCoordinatorReducer,
    ui: uiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(progressDebounceMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

