import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface SettingsState {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  autoScrollEnabled: boolean;
}

const initialState: SettingsState = {
  theme: 'system',
  fontSize: 16,
  fontFamily: 'system-ui',
  lineHeight: 1.6,
  autoScrollEnabled: false,
};

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    setTheme: (state, action: PayloadAction<'light' | 'dark' | 'system'>) => {
      state.theme = action.payload;
    },
    setFontSize: (state, action: PayloadAction<number>) => {
      state.fontSize = action.payload;
    },
    setFontFamily: (state, action: PayloadAction<string>) => {
      state.fontFamily = action.payload;
    },
    setLineHeight: (state, action: PayloadAction<number>) => {
      state.lineHeight = action.payload;
    },
    setAutoScrollEnabled: (state, action: PayloadAction<boolean>) => {
      state.autoScrollEnabled = action.payload;
    },
    updateSettings: (state, action: PayloadAction<Partial<SettingsState>>) => {
      return { ...state, ...action.payload };
    },
  },
});

export const {
  setTheme,
  setFontSize,
  setFontFamily,
  setLineHeight,
  setAutoScrollEnabled,
  updateSettings,
} = settingsSlice.actions;

export default settingsSlice.reducer;

