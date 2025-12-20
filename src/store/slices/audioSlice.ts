import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import type { AudioTrack } from '../../types/reader';

interface AudioState {
  currentTrackId: string | null;
  seekPosition: number | null;
  isPlaying: boolean;
  currentTrack: AudioTrack | null;
  trackUrl: string | null;
  isLoading: boolean;
}

const initialState: AudioState = {
  currentTrackId: null,
  seekPosition: null,
  isPlaying: false,
  currentTrack: null,
  trackUrl: null,
  isLoading: false,
};

const audioSlice = createSlice({
  name: 'audio',
  initialState,
  reducers: {
    setCurrentTrack: (state, action: PayloadAction<string | null>) => {
      state.currentTrackId = action.payload;
    },
    setSeekPosition: (state, action: PayloadAction<number | null>) => {
      state.seekPosition = action.payload;
    },
    setIsPlaying: (state, action: PayloadAction<boolean>) => {
      state.isPlaying = action.payload;
    },
    setCurrentTrackData: (state, action: PayloadAction<AudioTrack | null>) => {
      state.currentTrack = action.payload;
    },
    setTrackUrl: (state, action: PayloadAction<string | null>) => {
      state.trackUrl = action.payload;
    },
    setIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    resetAudio: () => initialState,
  },
});

export const {
  setCurrentTrack,
  setSeekPosition,
  setIsPlaying,
  setCurrentTrackData,
  setTrackUrl,
  setIsLoading,
  resetAudio,
} = audioSlice.actions;

export default audioSlice.reducer;

