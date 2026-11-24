import type { AppName } from './router';

export interface SystemColor {
  key: string;
  name: string;
  light: string;
  dark: string;
}

/** The Apple system palette (light and dark appearances). */
export const SYSTEM_COLORS: SystemColor[] = [
  { key: 'red', name: 'Red', light: '#FF3B30', dark: '#FF453A' },
  { key: 'orange', name: 'Orange', light: '#FF9500', dark: '#FF9F0A' },
  { key: 'yellow', name: 'Yellow', light: '#FFCC00', dark: '#FFD60A' },
  { key: 'green', name: 'Green', light: '#34C759', dark: '#30D158' },
  { key: 'mint', name: 'Mint', light: '#00C7BE', dark: '#63E6E2' },
  { key: 'teal', name: 'Teal', light: '#30B0C7', dark: '#40C8E0' },
  { key: 'cyan', name: 'Cyan', light: '#32ADE6', dark: '#64D2FF' },
  { key: 'blue', name: 'Blue', light: '#007AFF', dark: '#0A84FF' },
  { key: 'indigo', name: 'Indigo', light: '#5856D6', dark: '#5E5CE6' },
  { key: 'purple', name: 'Purple', light: '#AF52DE', dark: '#BF5AF2' },
  { key: 'pink', name: 'Pink', light: '#FF2D55', dark: '#FF375F' },
  { key: 'brown', name: 'Brown', light: '#A2845E', dark: '#AC8E68' },
];

/** Each app inside TrackMate has its own tint, the way Apple's own apps do. */
export const APP_TINT: Record<AppName, string> = {
  today: 'indigo',
  links: 'blue',
  tasks: 'orange',
  notes: 'yellow',
  calendar: 'red',
  tags: 'purple',
};

/** Swatches offered for tags, stages and events. */
export const SWATCHES: string[] = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#30B0C7',
  '#32ADE6', '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E',
  '#8E8E93', '#FF6B6B', '#F4A259', '#7BC950', '#2EC4B6', '#3A86FF',
];

export const PRIORITY = [
  { value: 0, label: 'None', color: '#8E8E93' },
  { value: 1, label: 'Low', color: '#007AFF' },
  { value: 2, label: 'Medium', color: '#FF9500' },
  { value: 3, label: 'High', color: '#FF3B30' },
] as const;

// ── colour maths for the custom colour picker ──────────────────────────────────────────────────

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 210, s: 1, v: 1 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

export const isHex = (value: string): boolean => /^#[0-9a-f]{6}$/i.test(value);

/** A stable hue (0–359) for any string — used for generated link banners and avatars. */
export function hueOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 360;
}
