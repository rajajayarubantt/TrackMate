// Link previews: fetch a page on the server (a browser is not allowed to read other sites) and
// read its title, description and banner image from the HTML.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const MAX_BYTES = 600_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;
const USER_AGENT = 'Mozilla/5.0 (compatible; TrackMateLinkPreview/1.0)';

function isPrivateV4(address) {
  const [a, b, c] = address.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

function isPrivateAddress(address) {
  if (isIP(address) === 4) return isPrivateV4(address);
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateV4(mapped[1]);
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('::ffff:') || lower.startsWith('64:ff9b:');
}

/** Only public web addresses may be fetched: never this machine, a private network or a cloud metadata service. */
export async function isPublicUrl(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (isIP(host)) return !isPrivateAddress(host);
  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 && addresses.every((entry) => !isPrivateAddress(entry.address));
  } catch {
    return false;
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try {
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      } catch {
        return whole;
      }
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const tidy = (text, max) => decodeEntities(String(text ?? '')).replace(/\s+/g, ' ').trim().slice(0, max);

function attributes(tag) {
  const found = {};
  const pattern = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) found[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  return found;
}

function absolute(value, base) {
  if (!value) return '';
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

/** Read Open Graph, Twitter card and plain HTML metadata out of a page's source. */
export function parseHtml(html, pageUrl) {
  const head = html.slice(0, MAX_BYTES);
  const metas = new Map();
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const name = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (name && attrs.content && !metas.has(name)) metas.set(name, attrs.content);
  }
  const meta = (...names) => {
    for (const name of names) if (metas.get(name)?.trim()) return metas.get(name);
    return '';
  };

  let icon = '';
  let iconRank = 0;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const rel = (attrs.rel || '').toLowerCase();
    if (!attrs.href || !/\bicon\b/.test(rel)) continue;
    const rank = rel.includes('apple-touch-icon') ? 2 : 1;
    if (rank > iconRank) {
      icon = attrs.href;
      iconRank = rank;
    }
  }

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '';
  return {
    title: tidy(meta('og:title', 'twitter:title') || title, 300),
    description: tidy(meta('og:description', 'twitter:description', 'description'), 600),
    image: absolute(meta('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'), pageUrl),
    favicon: absolute(icon, pageUrl),
    site_name: tidy(meta('og:site_name', 'application-name'), 120),
  };
}

async function readLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(total, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
    if (offset >= bytes.length) break;
  }
  return bytes;
}

function decode(bytes, contentType) {
  const declared = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(bytes.subarray(0, 2048)))?.[1];
  try {
    return new TextDecoder(declared || 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * @param {string} address the page to describe
 * @param {typeof fetch} [fetcher] replaced in tests
 * @returns {Promise<{ title: string, description: string, image: string, favicon: string, site_name: string } | null>}
 */
export async function preview(address, fetcher = fetch, allow = isPublicUrl) {
  let url;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!(await allow(url))) return null;
      const response = await fetcher(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'en' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        if (!location) return null;
        url = new URL(location, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (type.startsWith('image/')) {
        await response.body?.cancel().catch(() => undefined);
        return { title: '', description: '', image: url.href, favicon: '', site_name: '' };
      }
      if (type && !/html|xml|text\/plain/.test(type)) {
        await response.body?.cancel().catch(() => undefined);
        return null;
      }
      const meta = parseHtml(decode(await readLimited(response), type), url.href);
      return meta.title || meta.description || meta.image ? meta : null;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
