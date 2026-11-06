'use client';

import { create } from 'zustand';
import { THEME_STORAGE_KEY, THEME_TRANSITION_MS, isTheme, type Theme } from './themeCore';

export type { Theme } from './themeCore';

interface ThemeState {
  theme: Theme;
  setTheme(theme: Theme): void;
  toggle(): void;
}

function readDomTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const t = document.documentElement.dataset.theme;
  return isTheme(t) ? t : 'light';
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

let transitionTimer: ReturnType<typeof setTimeout> | undefined;

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (!prefersReducedMotion()) {
    root.classList.add('theme-transition');
    clearTimeout(transitionTimer);
    transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), THEME_TRANSITION_MS + 50);
  }
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* armazenamento indisponível (modo privado): mantém só na sessão */
  }
}

/** Tema atual. O valor inicial é definido pelo script de boot no <head>. */
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readDomTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));
