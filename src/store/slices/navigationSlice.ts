import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { LibraryFilterOption, LibraryViewMode } from '../../components/library/types';

export type AppView = 'library' | 'reader' | 'settings';

interface NavigationState {
  currentTab: AppView;
  librarySearchTerm: string;
  libraryFilter: LibraryFilterOption;
  libraryViewMode: LibraryViewMode;
}

const initialState: NavigationState = {
  currentTab: 'library',
  librarySearchTerm: '',
  libraryFilter: 'all',
  libraryViewMode: 'grid',
};

const navigationSlice = createSlice({
  name: 'navigation',
  initialState,
  reducers: {
    setCurrentTab: (state, action: PayloadAction<AppView>) => {
      state.currentTab = action.payload;
    },
    setLibrarySearchTerm: (state, action: PayloadAction<string>) => {
      state.librarySearchTerm = action.payload;
    },
    setLibraryFilter: (state, action: PayloadAction<LibraryFilterOption>) => {
      state.libraryFilter = action.payload;
    },
    setLibraryViewMode: (state, action: PayloadAction<LibraryViewMode>) => {
      state.libraryViewMode = action.payload;
    },
  },
});

export const {
  setCurrentTab,
  setLibrarySearchTerm,
  setLibraryFilter,
  setLibraryViewMode,
} = navigationSlice.actions;

export default navigationSlice.reducer;

