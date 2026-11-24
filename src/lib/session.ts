// Who is signed in. Accounts live on the server (MongoDB); this file talks to the API, keeps the
// signed-in person in a store the screens can read, and starts or stops the data sync.
import { seedDefaults, seedSamples } from '../db/seed';
import * as data from '../db/store';
import type { ServerUser } from '../db/store';
import type { Settings, User } from '../db/types';
import { api, ApiError } from './api';
import { applyAppearance } from './appearance';
import { createStore, useStore } from './store';

/** The id of the account this browser last used, so its offline copy can be opened before the server answers. */
const USER_KEY = 'tm.user';
/** Set when signing out could not reach the server, so the session cookie is cleared next time. */
const SIGNED_OUT_KEY = 'tm.signedOut';
export const MIN_PASSWORD = 8;

function detect24h(): boolean {
  const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h23' || cycle === 'h24';
}
function detectWeekStart(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return first === undefined ? 1 : first % 7;
  } catch {
    return 1;
  }
}

export const defaultSettings = (): Settings => ({
  theme: 'auto', tint: 'multi', glass: 62, aurora: true, time24: detect24h(), weekStart: detectWeekStart(),
  taskView: 'list', linkView: 'grid', calView: 'week', notify: false, chime: true,
  linkProvider: 'auto', defaultAlert: 10,
});

/** Fill in any setting the server does not have yet, and ignore any it has that this version does not know. */
function toUser(raw: ServerUser): User {
  const settings = defaultSettings() as unknown as Record<string, unknown>;
  const saved = (raw.settings ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(settings)) {
    if (saved[key] !== undefined) settings[key] = saved[key];
  }
  return { id: raw.id, email: raw.email, name: raw.name, settings: settings as unknown as Settings, created_at: raw.created_at };
}

export const session = createStore<User | null>(null);
/** Whether this TrackMate lets new people create accounts (the SIGNUP setting on the server). */
export const signupOpen = createStore(true);
export const useUser = (): User => useStore(session) as User;
export const useSettings = (): Settings => useUser().settings;
export const getSettings = (): Settings => session.get()?.settings ?? defaultSettings();

let notice: (message: string) => void = () => undefined;

function show(user: User): void {
  const current = session.get();
  if (current && JSON.stringify(current) === JSON.stringify(user)) return;
  session.set(user);
  applyAppearance(user.settings);
}

function leave(): void {
  data.stop();
  localStorage.removeItem(USER_KEY);
  session.set(null);
  // The sign-in screen needs to know whether it may offer "Create account".
  api<{ signup?: boolean }>('GET', 'me').then((answer) => signupOpen.set(answer.signup !== false), () => undefined);
}

/** The server no longer accepts this browser's session (it ran out, or the password changed elsewhere). */
function expire(): void {
  if (!session.get()) return;
  // Changes that were never sent stay in the offline copy and are sent after signing in again.
  void data.saveCache();
  leave();
  notice('You’ve been signed out. Sign in again to keep syncing.');
}

/** Load the account's data and show the app. */
async function enter(raw: ServerUser, options: { created?: boolean; samples?: boolean } = {}): Promise<void> {
  const cached = options.created ? undefined : await data.loadCache();
  data.start(raw, cached, options.created ? 0 : undefined);
  try {
    if (!options.created) await data.refresh({ force: true, strict: true });
  } catch (error) {
    data.stop();
    if (error instanceof ApiError && error.status === 401) {
      throw new Error('This browser did not keep you signed in. Allow cookies for this site, then try again.');
    }
    throw error;
  }
  // Every account needs board stages; a brand-new one (or one whose first save never arrived) gets the defaults.
  seedDefaults();
  if (options.samples) seedSamples();
  // Settings changed offline and not sent yet are part of the profile the store hands back.
  const user = toUser(data.currentProfile() ?? raw);
  localStorage.removeItem(SIGNED_OUT_KEY);
  localStorage.setItem(USER_KEY, user.id);
  session.set(user);
  applyAppearance(user.settings);
  void data.flush();
}

/**
 * Called once when the page opens: continue the last session if there is one.
 * @param onNotice shows a short message to the person (a toast)
 */
export async function boot(onNotice: (message: string) => void): Promise<void> {
  notice = onNotice;
  data.configure({ onUser: (raw) => session.get()?.id === raw.id && show(toUser(raw)), onExpired: expire, onNotice });

  if (localStorage.getItem(SIGNED_OUT_KEY)) {
    try {
      await api('POST', 'signout');
      localStorage.removeItem(SIGNED_OUT_KEY);
    } catch {
      return;
    }
  }

  // Open the copy kept in this browser straight away and catch up with the server in the background.
  const last = localStorage.getItem(USER_KEY);
  const cached = last ? await data.loadCache() : undefined;
  if (cached && cached.userId === last) {
    const user = toUser(cached.user);
    data.start(cached.user, cached);
    session.set(user);
    applyAppearance(user.settings);
    void data.refresh();
    return;
  }

  try {
    const answer = await api<{ user: ServerUser | null; signup?: boolean }>('GET', 'me');
    signupOpen.set(answer.signup !== false);
    if (answer.user) await enter(answer.user);
  } catch (error) {
    // Offline with nothing kept in this browser: show the sign-in screen, which explains when used.
    if (error instanceof ApiError && error.offline) return;
    throw error;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordRule = `Use a password with at least ${MIN_PASSWORD} characters.`;

export async function signUp(input: { name: string; email: string; password: string; samples: boolean }): Promise<void> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw new Error('Enter your name.');
  if (!EMAIL.test(email)) throw new Error('Enter a valid email address.');
  if (input.password.length < MIN_PASSWORD) throw new Error(passwordRule);
  const answer = await api<{ user: ServerUser }>('POST', 'signup', { name, email, password: input.password, settings: defaultSettings() });
  await enter(answer.user, { created: true, samples: input.samples });
}

export async function signIn(emailInput: string, password: string): Promise<void> {
  const email = emailInput.trim().toLowerCase();
  if (!email || !password) throw new Error('Enter your email and password.');
  const answer = await api<{ user: ServerUser }>('POST', 'signin', { email, password });
  await enter(answer.user);
}

/** Changes still waiting to be saved; signing out now would lose them. */
export const unsavedChanges = (): number => data.pendingCount();

export async function signOut(): Promise<void> {
  await Promise.race([data.flush(), new Promise((resolve) => window.setTimeout(resolve, 4000))]);
  try {
    await api('POST', 'signout');
  } catch {
    localStorage.setItem(SIGNED_OUT_KEY, '1');
  }
  leave();
  await data.clearCache();
}

function change(next: User, profile: { name?: string; settings?: Settings }): void {
  session.set(next);
  data.rememberUser(next);
  data.putProfile(profile);
}

export function updateSettings(patch: Partial<Settings>): void {
  const user = session.get();
  if (!user) return;
  const settings = { ...user.settings, ...patch };
  change({ ...user, settings }, { settings });
  applyAppearance(settings);
}

export function updateName(name: string): void {
  const user = session.get();
  if (!user || !name.trim()) return;
  change({ ...user, name: name.trim() }, { name: name.trim() });
}

export async function changePassword(current: string, next: string): Promise<void> {
  if (next.length < MIN_PASSWORD) throw new Error(passwordRule);
  await api('POST', 'password', { current, next });
}

/** Delete the account and everything in it, on the server and in this browser. */
export async function deleteAccount(password: string): Promise<void> {
  await api('POST', 'delete-account', { password });
  leave();
  await data.clearCache();
}
