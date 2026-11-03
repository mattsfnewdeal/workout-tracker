import { e1rm, type LoggedSet } from '../engine';
import type { Exercise, Program, Session, SetLog } from '../model/types';
import { db, type WorkoutDB } from './db';

type LoggedSetLog = SetLog & { load: number; reps: number };

/** A row that counts: it has reps and a real load. Anything else never reaches the engine or History. */
export function isLoggedRow(l: SetLog): l is LoggedSetLog {
  return l.reps != null && l.load != null && l.load > 0;
}

export function toLoggedSet(l: LoggedSetLog): LoggedSet {
  return { setNumber: l.setNumber, load: l.load, reps: l.reps, rpe: l.rpe ?? null };
}

/** `null` when there is no active program (so hooks can tell "none" from "loading"). */
export async function getActiveProgram(d: WorkoutDB = db): Promise<Program | null> {
  return (await d.programs.where('status').equals('active').first()) ?? null;
}

export async function getArchivedPrograms(d: WorkoutDB = db): Promise<Program[]> {
  const rows = await d.programs.where('status').equals('archived').toArray();
  return rows.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
}

export async function getInProgressSession(d: WorkoutDB = db): Promise<Session | null> {
  return (await d.sessions.where('completed').equals(0).first()) ?? null;
}

export function getSessionLogs(sessionId: string, d: WorkoutDB = db): Promise<SetLog[]> {
  return d.setLogs.where('sessionId').equals(sessionId).sortBy('setNumber');
}

export interface LastSets {
  session: Session;
  sets: LoggedSet[];
}

/**
 * The sets logged for an exercise in its most recent *completed* session,
 * regardless of day or program. In-progress sessions are ignored.
 */
export async function getLastCompletedSets(exerciseId: string, d: WorkoutDB = db): Promise<LastSets | null> {
  const logs = await d.setLogs.where('exerciseId').equals(exerciseId).toArray();
  if (logs.length === 0) return null;
  const sessionIds = [...new Set(logs.map((l) => l.sessionId))];
  const sessions = (await d.sessions.bulkGet(sessionIds)).filter(
    (s): s is Session => s != null && s.completed === 1,
  );
  if (sessions.length === 0) return null;
  const latest = sessions.reduce((a, b) => ((b.finishedAt ?? 0) > (a.finishedAt ?? 0) ? b : a));
  const sets = logs
    .filter((l): l is LoggedSetLog => l.sessionId === latest.id && isLoggedRow(l))
    .sort((a, b) => a.setNumber - b.setNumber)
    .map(toLoggedSet);
  return sets.length ? { session: latest, sets } : null;
}

export interface HistoryEntry {
  session: Session;
  sets: LoggedSet[];
  /** e1RM from set 1, or null when it can't be computed. */
  e1rm: number | null;
}

/** Completed sessions containing the exercise, newest first. */
export async function getExerciseHistory(exerciseId: string, d: WorkoutDB = db): Promise<HistoryEntry[]> {
  const logs = await d.setLogs.where('exerciseId').equals(exerciseId).toArray();
  const bySession = new Map<string, LoggedSetLog[]>();
  for (const l of logs) {
    if (!isLoggedRow(l)) continue;
    const arr = bySession.get(l.sessionId) ?? [];
    arr.push(l);
    bySession.set(l.sessionId, arr);
  }
  const sessions = (await d.sessions.bulkGet([...bySession.keys()])).filter(
    (s): s is Session => s != null && s.completed === 1,
  );
  sessions.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  return sessions.map((session) => {
    const sets = (bySession.get(session.id) ?? []).sort((a, b) => a.setNumber - b.setNumber).map(toLoggedSet);
    const s1 = sets.find((s) => s.setNumber === 1);
    return { session, sets, e1rm: s1 && s1.rpe != null ? e1rm(s1.load, s1.reps, s1.rpe) : null };
  });
}

/** Exercises with at least one logged set in a completed session, alphabetical. A slot skipped in its only session doesn't count. */
export async function getExercisesWithHistory(d: WorkoutDB = db): Promise<Exercise[]> {
  const completed = new Set((await d.sessions.where('completed').equals(1).toArray()).map((s) => s.id));
  const ids = new Set<string>();
  for (const l of await d.setLogs.toArray()) if (completed.has(l.sessionId) && isLoggedRow(l)) ids.add(l.exerciseId);
  const exercises = (await d.exercises.bulkGet([...ids])).filter((e): e is Exercise => e != null);
  return exercises.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getAllExercises(d: WorkoutDB = db): Promise<Exercise[]> {
  const all = await d.exercises.toArray();
  return all.sort((a, b) => a.name.localeCompare(b.name));
}
