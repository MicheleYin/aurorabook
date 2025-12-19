import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface UIState {
  autoScrollEnabled: boolean;
  deletingBookId: string | null;
}

const initialState: UIState = {
  autoScrollEnabled: true,
  deletingBookId: null,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setAutoScrollEnabled: (state, action: PayloadAction<boolean>) => {
      state.autoScrollEnabled = action.payload;
    },
    setDeletingBookId: (state, action: PayloadAction<string | null>) => {
      state.deletingBookId = action.payload;
    },
  },
});

export const {
  setAutoScrollEnabled,
  setDeletingBookId,
} = uiSlice.actions;

export default uiSlice.reducer;

