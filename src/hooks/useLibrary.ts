import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { selectLibrary, selectIsHydrated, selectIsLoading } from '../store/selectors';
import { refreshLibrary } from '../store/thunks/libraryThunks';

/**
 * Simplified library hook
 */
export function useLibrary() {
  const dispatch = useAppDispatch();
  const books = useAppSelector(selectLibrary);
  const isHydrated = useAppSelector(selectIsHydrated);
  const isLoading = useAppSelector(selectIsLoading);

  const refresh = useCallback(async () => {
    await dispatch(refreshLibrary()).unwrap();
  }, [dispatch]);

  return {
    books,
    isHydrated,
    isLoading,
    refresh,
  };
}
