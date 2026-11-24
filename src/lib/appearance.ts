import type { Settings } from '../db/types';

type Appearance = Pick<Settings, 'theme' | 'tint' | 'glass' | 'aurora'>;

let current: Appearance = { theme: 'auto', tint: 'multi', glass: 62, aurora: true };
const prefersDark = matchMedia('(prefers-color-scheme: dark)');

export function loadCachedAppearance(): void {
  try {
    current = { ...current, ...JSON.parse(localStorage.getItem('tm.appearance') || '{}') };
  } catch {
    /* keep defaults */
  }
  applyAppearance(current);
}

/** Push theme, tint and glass settings into CSS. */
export function applyAppearance(next: Appearance): void {
  current = { theme: next.theme, tint: next.tint, glass: next.glass, aurora: next.aurora };
  const root = document.documentElement;
  const dark = current.theme === 'dark' || (current.theme === 'auto' && prefersDark.matches);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.aurora = current.aurora ? 'on' : 'off';
  root.dataset.accent = current.tint;
  // 0 = ultra clear glass, 100 = fully tinted.
  root.style.setProperty('--glass', (0.16 + (current.glass / 100) * 0.76).toFixed(3));
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
  try {
    localStorage.setItem('tm.appearance', JSON.stringify(current));
  } catch {
    /* storage unavailable */
  }
}

prefersDark.addEventListener('change', () => applyAppearance(current));
export const isDark = (): boolean => document.documentElement.dataset.theme === 'dark';
