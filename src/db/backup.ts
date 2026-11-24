// Backups: the whole account as one JSON file, and putting such a file back.
import { COLLECTIONS, exportData, replaceAll } from './store';
import type { CollectionName, Doc, Snapshot } from './store';

const FORMAT = 'trackmate-backup';

export function backupFile(): string {
  return JSON.stringify({ format: FORMAT, version: 1, exported_at: new Date().toISOString(), data: exportData() }, null, 1);
}

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Replace everything in the account with the contents of a backup file. Throws if the file is not a TrackMate backup. */
export function restoreBackup(text: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This is not a TrackMate backup: the file could not be read as JSON.');
  }
  if (!isObject(parsed) || parsed.format !== FORMAT || !isObject(parsed.data)) {
    throw new Error('This is not a TrackMate backup. Choose a .json file made with “Download a backup”.');
  }
  const data: Partial<Snapshot> = {};
  for (const name of COLLECTIONS) {
    const list = parsed.data[name];
    if (list === undefined) continue;
    const key = name === 'reminders' ? 'key' : 'id';
    if (!Array.isArray(list) || list.some((doc) => !isObject(doc) || typeof doc[key] !== 'string' || !doc[key])) {
      throw new Error(`This backup is damaged: its ${name} could not be read.`);
    }
    data[name as CollectionName] = list as Doc[];
  }
  replaceAll(data);
}
