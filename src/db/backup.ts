import type { Exercise, MetaRow, Program, Session, SetLog } from '../model/types';
import { db, type WorkoutDB } from './db';

export const BACKUP_APP = 'workout-tracker';
export const SCHEMA_VERSION = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  schemaVersion: number;
  exportedAt: string;
  exercises: Exercise[];
  programs: Program[];
  sessions: Session[];
  setLogs: SetLog[];
  meta: MetaRow[];
}

export async function buildBackup(d: WorkoutDB = db): Promise<Backup> {
  const [exercises, programs, sessions, setLogs, meta] = await Promise.all([
    d.exercises.toArray(),
    d.programs.toArray(),
    d.sessions.toArray(),
    d.setLogs.toArray(),
    d.meta.toArray(),
  ]);
  return { app: BACKUP_APP, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), exercises, programs, sessions, setLogs, meta };
}

export function backupFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `workout-tracker-backup-${y}-${m}-${dd}.json`;
}

export function parseBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file isn’t valid JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('That file isn’t a backup');
  const b = data as Partial<Backup>;
  if (b.app !== BACKUP_APP) throw new Error('That file isn’t a Workout Tracker backup');
  if (typeof b.schemaVersion !== 'number' || b.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Backup schema v${String(b.schemaVersion)} is newer than this app (v${SCHEMA_VERSION})`);
  }
  for (const key of ['exercises', 'programs', 'sessions', 'setLogs', 'meta'] as const) {
    if (!Array.isArray(b[key])) throw new Error(`Backup is missing "${key}"`);
  }
  return b as Backup;
}

export function backupCounts(b: Backup) {
  return { exercises: b.exercises.length, programs: b.programs.length, sessions: b.sessions.length, setLogs: b.setLogs.length };
}

/** Replace everything with the backup's contents. */
export async function importBackup(b: Backup, d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.exercises, d.programs, d.sessions, d.setLogs, d.meta, async () => {
    await Promise.all([d.exercises.clear(), d.programs.clear(), d.sessions.clear(), d.setLogs.clear(), d.meta.clear()]);
    await d.exercises.bulkAdd(b.exercises);
    await d.programs.bulkAdd(b.programs);
    await d.sessions.bulkAdd(b.sessions);
    await d.setLogs.bulkAdd(b.setLogs);
    await d.meta.bulkAdd(b.meta.filter((m) => m.key !== 'lastBackupAt'));
    const when = Date.parse(b.exportedAt);
    await d.meta.put({ key: 'lastBackupAt', value: Number.isFinite(when) ? when : Date.now() });
  });
}

export async function markBackedUp(when = Date.now(), d: WorkoutDB = db): Promise<void> {
  await d.meta.put({ key: 'lastBackupAt', value: when });
}

export async function getLastBackupAt(d: WorkoutDB = db): Promise<number | undefined> {
  return (await d.meta.get('lastBackupAt'))?.value;
}

/**
 * Hand the backup to the user. In iOS standalone mode `a[download]` is
 * unreliable, so prefer the share sheet when files can be shared.
 * Resolves true when the user completed a share/download.
 */
export async function exportBackup(d: WorkoutDB = db): Promise<boolean> {
  const backup = await buildBackup(d);
  const json = JSON.stringify(backup, null, 2);
  const name = backupFilename();
  const file = new File([json], name, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return false;
      throw err;
    }
  } else {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  await markBackedUp(Date.now(), d);
  return true;
}
