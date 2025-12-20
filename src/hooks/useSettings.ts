import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectSettings } from '../store/selectors';
import { updateSettings } from '../store/slices/settingsSlice';

/**
 * Simplified settings hook with localStorage persistence
 */
export function useSettings() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector(selectSettings);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('app-settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        dispatch(updateSettings(parsed));
      }
    } catch (error) {
      console.warn('Failed to load settings from localStorage', error);
    }
  }, [dispatch]);

  // Save to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem('app-settings', JSON.stringify(settings));
    } catch (error) {
      console.warn('Failed to save settings to localStorage', error);
    }
  }, [settings]);

  return {
    settings,
    updateSettings: (updates: Partial<typeof settings>) => {
      dispatch(updateSettings(updates));
    },
  };
}

