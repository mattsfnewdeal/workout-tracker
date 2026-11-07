import { DEFAULT_TARGET_RPE } from '../engine';
import type { Day, Exercise, PlannedSlot, Program, Session, SetLog, Slot, SlotSpec, WarmupItem } from '../model/types';
import { db, type WorkoutDB } from './db';
import { getInProgressSession } from './queries';

export const DEFAULT_INCREMENT = 5;

export function newId(): string {
  return crypto.randomUUID();
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Reuse an existing exercise by case-insensitive name so history continues; otherwise create it. */
export async function findOrCreateExercise(
  name: string,
  loadIncrement = DEFAULT_INCREMENT,
  d: WorkoutDB = db,
): Promise<Exercise> {
  const norm = normalizeName(name);
  if (!norm) throw new Error('Exercise name is required');
  const lower = norm.toLowerCase();
  const existing = (await d.exercises.toArray()).find((e) => e.name.toLowerCase() === lower);
  if (existing) return existing;
  const ex: Exercise = { id: newId(), name: norm, loadIncrement, createdAt: Date.now() };
  await d.exercises.add(ex);
  return ex;
}

export async function updateExercise(id: string, patch: Partial<Pick<Exercise, 'name' | 'loadIncrement' | 'bodyweight'>>, d: WorkoutDB = db) {
  const clean: typeof patch = { ...patch };
  if (clean.name != null) clean.name = normalizeName(clean.name);
  await d.exercises.update(id, clean);
}

export function newDay(name: string): Day {
  return { id: newId(), name, warmups: [], slots: [] };
}

export function newWarmup(name: string, note?: string): WarmupItem {
  const n = normalizeName(note ?? '');
  return { id: newId(), name: normalizeName(name), ...(n ? { note: n } : {}) };
}

export function newSlot(exerciseId: string, partial: Partial<Slot> = {}): Slot {
  const slot: Slot = { id: newId(), exerciseId, sets: 3, progression: 'single', targetRpe: DEFAULT_TARGET_RPE, ...partial };
  if (slot.progression === 'single') slot.targetReps ??= 5;
  else {
    slot.repMin ??= 6;
    slot.repMax ??= 8;
  }
  return slot;
}

/** Switch a slot between fixed reps and a rep range, carrying the visible number across: Fixed 5 → Range 5–7, Range 6–8 → Fixed 6. */
export function switchProgression<T extends SlotSpec>(slot: T, progression: Slot['progression']): T {
  if (progression === slot.progression) return slot;
  if (progression === 'single') return { ...slot, progression, targetReps: slot.repMin ?? slot.targetReps ?? 5 };
  const repMin = slot.targetReps ?? slot.repMin ?? 6;
  const repMax = slot.repMax != null && slot.repMax > repMin ? slot.repMax : repMin + 2;
  return { ...slot, progression, repMin, repMax };
}

/** Drop fields older builds stored on slots (v1.1 startingLoad) so they don't outlive the file or device they came from. */
export function stripLegacySlotFields(program: Program): Program {
  return {
    ...program,
    days: program.days.map((day) => ({
      ...day,
      slots: day.slots.map((s) => {
        const copy = { ...s } as Slot & { startingLoad?: number };
        delete copy.startingLoad;
        return copy as Slot;
      }),
    })),
  };
}

export function emptyProgram(name = 'My program'): Program {
  return {
    id: newId(),
    name,
    days: [newDay('Day A'), newDay('Day B')],
    nextDayIndex: 0,
    status: 'active',
    createdAt: Date.now(),
  };
}

/** Why a slot's sets / reps aren't valid, or null when they are. */
export function slotProblem(slot: SlotSpec & { introSets?: number }): string | null {
  if (!Number.isInteger(slot.sets) || slot.sets < 1) return 'sets must be at least 1';
  if (slot.introSets != null && (!Number.isInteger(slot.introSets) || slot.introSets < 1)) return 'intro sets must be at least 1';
  if ((slot.rule == null || slot.rule === 'rpe') && slot.targetRpe == null) return 'needs an RPE goal (or the linear / manual rule)';
  if (slot.progression === 'single') {
    if (!Number.isInteger(slot.targetReps) || (slot.targetReps ?? 0) < 1) return 'target reps must be at least 1';
  } else {
    const { repMin, repMax } = slot;
    if (!Number.isInteger(repMin) || !Number.isInteger(repMax) || (repMin ?? 0) < 1 || (repMax ?? 0) <= (repMin ?? 0)) {
      return 'rep range must be like 6–8';
    }
  }
  return null;
}

/** Throws with a human-readable message when a program isn't valid to save. */
export function validateProgram(p: Program): void {
  if (!normalizeName(p.name)) throw new Error('Program needs a name');
  if (p.days.length === 0) throw new Error('Program needs at least one day');
  if (p.introWeeks != null && (!Number.isInteger(p.introWeeks) || p.introWeeks < 0)) throw new Error('Intro weeks must be a whole number');
  for (const day of p.days) {
    for (const w of day.warmups ?? []) if (!normalizeName(w.name)) throw new Error(`${day.name}: a warm-up needs a name`);
    const seen = new Set<string>();
    for (const slot of day.slots) {
      if (seen.has(slot.exerciseId)) throw new Error(`${day.name}: the same exercise can't appear twice in one day`);
      seen.add(slot.exerciseId);
      const problem = slotProblem(slot);
      if (problem) throw new Error(`${day.name}: ${problem}`);
    }
  }
}

/** Save edits to a program. Clamps the day pointer if days were removed. */
export async function saveProgram(program: Program, d: WorkoutDB = db): Promise<void> {
  validateProgram(program);
  const next = program.days.length ? program.nextDayIndex % program.days.length : 0;
  await d.programs.put(stripLegacySlotFields({ ...program, name: normalizeName(program.name), nextDayIndex: next }));
}

/** Make `program` the active one, archiving whatever was active. Blocked while a session is in progress. */
export async function createProgram(program: Program, d: WorkoutDB = db): Promise<void> {
  validateProgram(program);
  await d.transaction('rw', d.programs, d.sessions, async () => {
    if (await getInProgressSession(d)) throw new Error('Finish or abandon the current session before starting a new program');
    const now = Date.now();
    const active = await d.programs.where('status').equals('active').toArray();
    for (const p of active) {
      if (p.id !== program.id) await d.programs.update(p.id, { status: 'archived', archivedAt: now });
    }
    await d.programs.put(stripLegacySlotFields({ ...program, name: normalizeName(program.name), status: 'active', archivedAt: undefined }));
  });
}

/** One empty row per set of a planned slot, prefilled with the suggested load when there is one. */
export function setRowsFor(sessionId: string, slot: PlannedSlot): SetLog[] {
  const logs: SetLog[] = [];
  for (let n = 1; n <= slot.sets; n++) {
    const row: SetLog = { id: newId(), sessionId, slotId: slot.slotId, exerciseId: slot.exerciseId, setNumber: n };
    if (slot.suggestion.load != null) {
      row.suggestedLoad = slot.suggestion.load;
      // A bodyweight slot's "0" stays an empty field (BW); anything typed is added weight.
      if (!(slot.bodyweight && slot.suggestion.load === 0)) row.load = slot.suggestion.load;
    }
    logs.push(row);
  }
  return logs;
}

/** Delete an archived program. Its sessions and set rows stay: History is per exercise. The active program can't be deleted. */
export async function deleteProgram(id: string, d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.programs, async () => {
    const p = await d.programs.get(id);
    if (!p) return;
    if (p.status === 'active') throw new Error('Create a new program first; the active one can’t be deleted');
    await d.programs.delete(id);
  });
}

/** Create the session and pre-create every set row, prefilled with the suggested load when there is one. */
export async function startSession(program: Program, dayIndex: number, plan: PlannedSlot[], d: WorkoutDB = db): Promise<Session> {
  const day = program.days[dayIndex];
  if (!day) throw new Error('No such day');
  const session: Session = {
    id: newId(),
    programId: program.id,
    dayId: day.id,
    dayIndex,
    dayName: day.name,
    startedAt: Date.now(),
    completed: 0,
    warmups: (day.warmups ?? []).map((w) => ({ id: w.id, name: w.name, ...(w.note ? { note: w.note } : {}), done: false })),
    plan,
  };
  const logs = plan.flatMap((slot) => setRowsFor(session.id, slot));
  await d.transaction('rw', d.sessions, d.setLogs, async () => {
    if (await getInProgressSession(d)) throw new Error('A session is already in progress');
    await d.sessions.add(session);
    await d.setLogs.bulkAdd(logs);
  });
  return session;
}

/** Tick or untick one warm-up item on an in-progress session. */
export async function setWarmupDone(sessionId: string, itemId: string, done: boolean, d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.sessions, async () => {
    const s = await d.sessions.get(sessionId);
    if (!s) return;
    await d.sessions.update(sessionId, { warmups: (s.warmups ?? []).map((w) => (w.id === itemId ? { ...w, done } : w)) });
  });
}

/** Tick or untick one suggested warm-up set of a slot on an in-progress session. */
export async function setWarmupSetDone(sessionId: string, slotId: string, index: number, done: boolean, d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.sessions, async () => {
    const s = await d.sessions.get(sessionId);
    if (!s) return;
    const plan = s.plan.map((slot) =>
      slot.slotId === slotId && slot.warmupSets?.[index]
        ? { ...slot, warmupSets: slot.warmupSets.map((w, i) => (i === index ? { ...w, done } : w)) }
        : slot,
    );
    await d.sessions.update(sessionId, { plan });
  });
}

export type SetLogPatch = Partial<Pick<SetLog, 'load' | 'reps' | 'rpe'>>;

export function updateSetLog(id: string, patch: SetLogPatch, d: WorkoutDB = db): Promise<number> {
  return d.setLogs.update(id, patch);
}

export interface FinishCheck {
  /** Blocking problems, e.g. a slot with 2 of 3 sets logged or set 1 without RPE. */
  problems: string[];
  /** Exercise names with no sets logged; allowed after confirmation. */
  skipped: string[];
}

/** A slot is either fully logged (every set has reps, set 1 has RPE) or entirely skipped. */
export function checkFinish(session: Session, logs: SetLog[]): FinishCheck {
  const problems: string[] = [];
  const skipped: string[] = [];
  for (const slot of session.plan) {
    const rows = logs.filter((l) => l.slotId === slot.slotId);
    const logged = rows.filter((l) => l.reps != null);
    if (logged.length === 0) {
      skipped.push(slot.exerciseName);
      continue;
    }
    if (logged.length < slot.sets) problems.push(`${slot.exerciseName}: ${logged.length} of ${slot.sets} sets logged`);
    const set1 = rows.find((l) => l.setNumber === 1);
    if (set1 && set1.reps != null && set1.rpe == null) problems.push(`${slot.exerciseName}: set 1 needs an RPE`);
    for (const l of logged) {
      if (slot.bodyweight) {
        if (l.load != null && l.load < 0) problems.push(`${slot.exerciseName} set ${l.setNumber}: added weight can't be negative`);
      } else if (l.load == null) problems.push(`${slot.exerciseName} set ${l.setNumber}: enter the load`);
      else if (!(l.load > 0)) problems.push(`${slot.exerciseName} set ${l.setNumber}: load must be above 0`);
      if (!Number.isInteger(l.reps) || (l.reps ?? 0) < 0) problems.push(`${slot.exerciseName} set ${l.setNumber}: reps must be a whole number`);
    }
  }
  return { problems, skipped };
}

/** Save the session, drop unlogged rows, advance the A/B pointer. */
export async function finishSession(sessionId: string, d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.sessions, d.setLogs, d.programs, async () => {
    const session = await d.sessions.get(sessionId);
    if (!session) throw new Error('Session not found');
    if (session.completed) return;
    const logs = await d.setLogs.where('sessionId').equals(sessionId).toArray();
    const { problems } = checkFinish(session, logs);
    if (problems.length) throw new Error(problems.join('\n'));
    const unlogged = logs.filter((l) => l.reps == null).map((l) => l.id);
    if (unlogged.length) await d.setLogs.bulkDelete(unlogged);
    // Bodyweight rows logged with the load left empty are bodyweight: store 0 so they count in History and progression.
    const bwSlots = new Set(session.plan.filter((s) => s.bodyweight).map((s) => s.slotId));
    for (const l of logs) if (l.reps != null && l.load == null && bwSlots.has(l.slotId)) await d.setLogs.update(l.id, { load: 0 });
    await d.sessions.update(sessionId, { completed: 1, finishedAt: Date.now() });
    const program = await d.programs.get(session.programId);
    if (program && program.days.length) {
      await d.programs.update(program.id, { nextDayIndex: (session.dayIndex + 1) % program.days.length });
    }
  });
}

/** Delete the session and its rows. The pointer doesn't move. */
export async function abandonSession(sessionId: string, d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.sessions, d.setLogs, async () => {
    await d.setLogs.where('sessionId').equals(sessionId).delete();
    await d.sessions.delete(sessionId);
  });
}

export async function resetAll(d: WorkoutDB = db): Promise<void> {
  await d.transaction('rw', d.exercises, d.programs, d.sessions, d.setLogs, d.meta, async () => {
    await Promise.all([d.exercises.clear(), d.programs.clear(), d.sessions.clear(), d.setLogs.clear(), d.meta.clear()]);
  });
}
