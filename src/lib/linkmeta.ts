// Link previews. A browser cannot read another site's HTML directly, so the title, description and
// banner are looked up by TrackMate's own server (/api/preview) and, when a site refuses that, by
// Microlink. If nothing answers, the link is still saved with details derived from its address.
import type { Settings } from '../db/types';
import { api } from './api';

export interface LinkMeta {
  title: string;
  description: string;
  image: string;
  favicon: string;
  site_name: string;
}

/** Turn what was typed or pasted into a full http(s) address, or null if it is not a link. */
export function parseUrl(input: string): string | null {
  let text = input.trim();
  if (!text || /\s/.test(text)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const looksLikeHost = /^[^\s/@]+\.[a-z]{2,}(?=$|[/?#:])/i.test(text) || /^localhost(?=$|[/:])/i.test(text);
    if (!looksLikeHost) return null;
    text = `https://${text}`;
  }
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A comparable form of an address, used to spot links that are already saved. */
export function canonical(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|igshid$)/i.test(key)) u.searchParams.delete(key);
    }
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export const faviconFor = (url: string): string => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=64`;

function derive(url: string): LinkMeta {
  const host = hostOf(url);
  let title = host;
  try {
    const segment = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    const words = segment.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[-_+]+/g, ' ').trim();
    if (words && !/^\d+$/.test(words)) title = words.charAt(0).toUpperCase() + words.slice(1);
  } catch {
    /* keep the host */
  }
  return { title, description: '', image: '', favicon: '', site_name: host };
}

const absolute = (value: string | null | undefined, base: string): string => {
  if (!value) return '';
  try {
    const url = new URL(value, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
};

type Json = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const urlOf = (value: unknown): string => (typeof value === 'string' ? value : value && typeof value === 'object' ? text((value as Json).url) : '');

/** Accepts Microlink's shape ({ data: { title, image: { url }, … } }) or a flat { title, description, image } object. */
function fromJson(json: Json, url: string): Partial<LinkMeta> | null {
  const data = (json.data && typeof json.data === 'object' ? json.data : json) as Json;
  const meta: Partial<LinkMeta> = {
    title: text(data.title),
    description: text(data.description),
    image: absolute(urlOf(data.image), url),
    favicon: absolute(urlOf(data.logo) || urlOf(data.favicon) || urlOf(data.icon), url),
    site_name: text(data.publisher) || text(data.site_name) || text(data.siteName),
  };
  return meta.title || meta.description || meta.image ? meta : null;
}

/** TrackMate's own server fetches the page and reads its metadata. */
async function fromServer(url: string): Promise<Partial<LinkMeta> | null> {
  try {
    const answer = await api<{ meta: Json | null }>('GET', `preview?url=${encodeURIComponent(url)}`, undefined, { timeoutMs: 12_000 });
    return answer.meta ? fromJson(answer.meta, url) : null;
  } catch {
    return null;
  }
}

async function fromMicrolink(url: string): Promise<Partial<LinkMeta> | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`, { signal: controller.signal });
    return response.ok ? fromJson((await response.json()) as Json, url) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1) || null;
    if (host === 'youtube.com') return u.searchParams.get('v') ?? (/^\/(shorts|embed)\/([^/]+)/.exec(u.pathname)?.[2] ?? null);
  } catch {
    /* not a video link */
  }
  return null;
}

export async function fetchLinkMeta(url: string, settings: Pick<Settings, 'linkProvider'>): Promise<LinkMeta> {
  const base = derive(url);
  const video = youtubeId(url);
  if (video) base.image = `https://i.ytimg.com/vi/${video}/hqdefault.jpg`;
  const provider = settings.linkProvider;
  if (provider === 'off') return base;

  let found: Partial<LinkMeta> | null = null;
  if (provider !== 'microlink') found = await fromServer(url);
  if (!found && provider !== 'server') found = await fromMicrolink(url);
  if (!found) return base;
  return {
    title: found.title || base.title,
    description: found.description || '',
    image: found.image || base.image,
    favicon: found.favicon || '',
    site_name: found.site_name || base.site_name,
  };
}
