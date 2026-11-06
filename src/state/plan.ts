import { DEFAULT_TARGET_RPE, suggest, warmupSets, type SlotParams } from '../engine';
import type { Exercise, PlannedSlot, Program, Slot } from '../model/types';
import { db, type WorkoutDB } from '../db/db';
import { getRecentCompletedSets } from '../db/queries';

export function toSlotParams(slot: Slot, exercise: Exercise): SlotParams {
  const common = {
    targetRpe: slot.targetRpe ?? DEFAULT_TARGET_RPE,
    increment: exercise.loadIncrement,
    ...(exercise.bodyweight ? { bodyweight: true } : {}),
    ...(slot.rule === 'linear' ? { rule: 'linear' as const } : {}),
  };
  return slot.progression === 'single'
    ? { progression: 'single', targetReps: slot.targetReps ?? 5, ...common }
    : { progression: 'double', repMin: slot.repMin ?? 6, repMax: slot.repMax ?? 8, ...common };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** When the intro weeks end: `introWeeks` after they start (which defaults to the program's creation). null when there are none. */
export function introEndsAt(program: Pick<Program, 'createdAt' | 'introWeeks' | 'introStartsAt'>): number | null {
  if (!program.introWeeks || program.introWeeks <= 0) return null;
  return (program.introStartsAt ?? program.createdAt) + program.introWeeks * WEEK_MS;
}

/** True until the intro weeks end (including any "week 0" before they start), when slots run their reduced set counts. */
export function inIntroWeeks(program: Pick<Program, 'createdAt' | 'introWeeks' | 'introStartsAt'>, now = Date.now()): boolean {
  const end = introEndsAt(program);
  return end != null && now < end;
}

export interface PlanSlotOptions {
  /** Use the slot's intro set count when it has one. */
  intro?: boolean;
  /** The slot is the second or later exercise of a superset: it is logged warm, so no warm-up sets. */
  supersetWithPrev?: boolean;
}

/** Snapshot one slot with a suggestion from the exercise's last completed sets. */
export async function planSlot(slot: Slot, exercise: Exercise, d: WorkoutDB = db, opts: PlanSlotOptions = {}): Promise<PlannedSlot> {
  const params = toSlotParams(slot, exercise);
  const recent = await getRecentCompletedSets(slot.exerciseId, params.rule === 'linear' ? 2 : 1, d);
  const last = recent[0] ?? null;
  const suggestion = suggest(params, last?.sets ?? null, recent[1]?.sets ?? null);
  const intro = !!opts.intro && slot.introSets != null && slot.introSets !== slot.sets;
  const warmups = suggestion.load != null && !opts.supersetWithPrev
    ? warmupSets({ workingLoad: suggestion.load, increment: exercise.loadIncrement, repTarget: suggestion.repTarget, exerciseName: exercise.name, bodyweight: !!exercise.bodyweight })
    : null;
  return {
    slotId: slot.id,
    exerciseId: slot.exerciseId,
    exerciseName: exercise.name,
    sets: intro ? (slot.introSets as number) : slot.sets,
    ...(intro ? { fullSets: slot.sets } : {}),
    increment: exercise.loadIncrement,
    ...(exercise.bodyweight ? { bodyweight: true } : {}),
    ...(slot.rule === 'linear' ? { rule: 'linear' as const } : {}),
    ...(slot.targetRpe != null ? { targetRpe: slot.targetRpe } : {}),
    ...(opts.supersetWithPrev ? { supersetWithPrev: true } : {}),
    ...(last?.session.finishedAt != null ? { lastSessionAt: last.session.finishedAt } : {}),
    suggestion,
    ...(warmups ? { warmupSets: warmups.map((w) => ({ ...w, done: false })) } : {}),
  };
}

/** Join the program's day with each exercise's last completed sets to get suggestions. */
export async function buildPlan(program: Program, dayIndex: number, d: WorkoutDB = db, now = Date.now()): Promise<PlannedSlot[]> {
  const day = program.days[dayIndex];
  if (!day) return [];
  const intro = inIntroWeeks(program, now);
  const out: PlannedSlot[] = [];
  for (const [i, slot] of day.slots.entries()) {
    const exercise = await d.exercises.get(slot.exerciseId);
    if (!exercise) continue;
    out.push(await planSlot(slot, exercise, d, { intro, supersetWithPrev: i > 0 && !!slot.supersetWithPrev }));
  }
  return out;
}

/** Order labels aligned to the slots: "1", "2", … for single exercises and "5A", "5B" for the members of a superset. */
export function orderLabels<T extends { supersetWithPrev?: boolean }>(slots: T[]): string[] {
  const out: string[] = [];
  supersetGroups(slots).forEach((group, g) => {
    group.forEach((_, i) => out.push(group.length > 1 ? `${g + 1}${String.fromCharCode(65 + i)}` : `${g + 1}`));
  });
  return out;
}

/** Group a plan into supersets: runs of slots where each after the first is marked supersetWithPrev. */
export function supersetGroups<T extends { supersetWithPrev?: boolean }>(slots: T[]): T[][] {
  const groups: T[][] = [];
  for (const slot of slots) {
    if (slot.supersetWithPrev && groups.length) groups[groups.length - 1].push(slot);
    else groups.push([slot]);
  }
  return groups;
}
