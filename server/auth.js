// Passwords and sessions.
//
// Passwords are stored as scrypt hashes. A session is a signed token kept in an HttpOnly cookie, so
// the function needs no session table: it checks the signature, then checks the account still
// exists and has not changed its password since the token was issued.
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { ConfigError } from './errors.js';
import { isHosted } from './db.js';

const COOKIE = 'tm_session';
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

const b64 = (buffer) => Buffer.from(buffer).toString('base64url');

function derive(password, salt, params) {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, params.keylen, { N: params.N, r: params.r, p: params.p }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, b64(salt), b64(key)].join(':');
}

/** A hash of nothing, used to spend the same time on unknown accounts as on wrong passwords. */
let decoy;
const decoyHash = () => (decoy ??= hashPassword(randomBytes(12).toString('hex')));

export async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored ?? (await decoyHash())).split(':');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length });
  return stored != null && actual.length === expected.length && timingSafeEqual(actual, expected);
}

let warned = false;
function secret() {
  const value = (process.env.SESSION_SECRET || '').trim();
  // The placeholder from .env.example is public, so it must never be accepted as the secret.
  if (value.length >= 16 && value !== 'replace-with-a-long-random-value') return value;
  if (isHosted()) {
    throw new ConfigError(
      'SESSION_SECRET is not set (or is too short, or still the example value). Add a long random value as the SESSION_SECRET environment variable in Vercel, then redeploy.',
    );
  }
  if (!warned) {
    warned = true;
    console.warn('  SESSION_SECRET is not set: using a fixed development secret. Set one before deploying.');
  }
  return 'trackmate-development-only-secret';
}

/** Throws when the deployment has no session secret. */
export const assertConfigured = () => void secret();

const sign = (payload) => b64(createHmac('sha256', secret()).update(payload).digest());

export function createToken(userId, tokenVersion, now = Date.now()) {
  const payload = b64(JSON.stringify({ u: userId, v: tokenVersion, e: now + SESSION_DAYS * DAY }));
  return `${payload}.${sign(payload)}`;
}

/** @returns {{ userId: string, tokenVersion: number, expires: number } | null} */
export function readToken(token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.u !== 'string' || typeof data.v !== 'number' || typeof data.e !== 'number' || data.e < now) return null;
    return { userId: data.u, tokenVersion: data.v, expires: data.e };
  } catch {
    return null;
  }
}

export function tokenFromRequest(request) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === COOKIE) return part.slice(index + 1).trim();
  }
  return '';
}

const isSecure = (request) =>
  request.headers.get('x-forwarded-proto')?.split(',')[0].trim() === 'https' || new URL(request.url, 'http://localhost').protocol === 'https:';

export function sessionCookie(request, token) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`];
  if (isSecure(request)) parts.push('Secure');
  return parts.join('; ');
}

export function clearedCookie(request) {
  const parts = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure(request)) parts.push('Secure');
  return parts.join('; ');
}

/** True when the token is past the halfway point of its life and should be replaced. */
export const shouldRenew = (expires, now = Date.now()) => expires - now < (SESSION_DAYS * DAY) / 2;
