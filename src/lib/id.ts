const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Random id. Uses getRandomValues, which (unlike randomUUID) also works on plain-http origins. */
export function uid(length = 14): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 36];
  return out;
}
