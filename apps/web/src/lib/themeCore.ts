/**
 * Núcleo do sistema de temas (sem dependência de React/DOM — testável).
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'agency-os:theme';
export const THEME_TRANSITION_MS = 450;

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark';
}

/** Preferência salva > preferência do sistema > claro. */
export function resolveInitialTheme(stored: string | null | undefined, prefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return prefersDark ? 'dark' : 'light';
}

/**
 * Script executado no <head> ANTES da primeira pintura, para evitar flash do
 * tema errado. Mantido mínimo e sem dependências.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;}catch(e){document.documentElement.dataset.theme='light';}})();`;
