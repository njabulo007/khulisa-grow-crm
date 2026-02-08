import { STORAGE_KEYS, readStoredValue, writeStoredValue } from './storage';

export type ThemeMode = 'light' | 'dark';

export interface ThemeService {
  get: () => ThemeMode;
  set: (theme: ThemeMode) => void;
}

class LocalThemeService implements ThemeService {
  // TODO: Replace implementation with Firebase-backed user preferences if needed.
  get(): ThemeMode {
    const theme = readStoredValue(STORAGE_KEYS.theme);
    return theme === 'dark' ? 'dark' : 'light';
  }

  set(theme: ThemeMode): void {
    writeStoredValue(STORAGE_KEYS.theme, theme);
  }
}

export const themeService: ThemeService = new LocalThemeService();
