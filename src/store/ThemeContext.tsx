import AsyncStorage from '@react-native-async-storage/async-storage';

import { getStorageItemWithLegacy } from '../lib/asyncStorageCompat';
import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';

const LEGACY_STORAGE_KEY = 'booknest.theme.v1';
const STORAGE_KEY = 'honnoma.theme.v1';

type ThemeColors = {
  background: string;
  surface: string;
  elevated: string;
  text: string;
  muted: string;
  border: string;
  input: string;
  primary: string;
  danger: string;
  success: string;
};

type ThemeContextValue = {
  mode: ThemeMode;
  resolvedMode: 'light' | 'dark';
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
};

const lightColors: ThemeColors = {
  background: '#ffffff',
  surface: '#ffffff',
  elevated: '#f4f4f4',
  text: '#111111',
  muted: '#666666',
  border: '#e5e5e5',
  input: '#f4f4f4',
  primary: '#0a84ff',
  danger: '#ff3b30',
  success: '#138a3d',
};

const darkColors: ThemeColors = {
  background: '#0d1117',
  surface: '#161b22',
  elevated: '#21262d',
  text: '#f0f6fc',
  muted: '#b7c0cc',
  border: '#30363d',
  input: '#1f2630',
  primary: '#58a6ff',
  danger: '#ff453a',
  success: '#31c759',
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemMode = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    getStorageItemWithLegacy(STORAGE_KEY, LEGACY_STORAGE_KEY).then((storedMode) => {
      if (storedMode === 'system' || storedMode === 'light' || storedMode === 'dark') {
        setModeState(storedMode);
      }
    });
  }, []);

  const setMode = (nextMode: ThemeMode) => {
    setModeState(nextMode);
    AsyncStorage.setItem(STORAGE_KEY, nextMode);
  };

  const resolvedMode = mode === 'system' ? (systemMode === 'dark' ? 'dark' : 'light') : mode;
  const colors = resolvedMode === 'dark' ? darkColors : lightColors;

  const value = useMemo(
    () => ({
      mode,
      resolvedMode,
      colors,
      setMode,
    }),
    [colors, mode, resolvedMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useAppTheme must be used inside ThemeProvider');
  }

  return context;
}
