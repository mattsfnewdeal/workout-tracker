import { suggest, warmupSets, type SlotParams } from '../engine';
import type { Exercise, PlannedSlot, Program, Slot } from '../model/types';
import { db, type WorkoutDB } from '../db/db';
import { getLastCompletedSets } from '../db/queries';

export function toSlotParams(slot: Slot, exercise: Exercise): SlotParams {
  const common = { targetRpe: slot.targetRpe, increment: exercise.loadIncrement, ...(exercise.bodyweight ? { bodyweight: true } : {}) };
  return slot.progression === 'single'
    ? { progression: 'single', targetReps: slot.targetReps ?? 5, ...common }
    : { progression: 'double', repMin: slot.repMin ?? 6, repMax: slot.repMax ?? 8, ...common };
}

/** Snapshot one slot with a suggestion from the exercise's last completed sets. */
export async function planSlot(slot: Slot, exercise: Exercise, d: WorkoutDB = db): Promise<PlannedSlot> {
  const last = await getLastCompletedSets(slot.exerciseId, d);
  const suggestion = suggest(toSlotParams(slot, exercise), last?.sets ?? null);
  return {
    slotId: slot.id,
    exerciseId: slot.exerciseId,
    exerciseName: exercise.name,
    sets: slot.sets,
    increment: exercise.loadIncrement,
    ...(exercise.bodyweight ? { bodyweight: true } : {}),
    ...(last?.session.finishedAt != null ? { lastSessionAt: last.session.finishedAt } : {}),
    suggestion,
    ...(suggestion.load != null
      ? { warmupSets: warmupSets({ workingLoad: suggestion.load, increment: exercise.loadIncrement, repTarget: suggestion.repTarget, exerciseName: exercise.name, bodyweight: !!exercise.bodyweight }).map((w) => ({ ...w, done: false })) }
      : {}),
  };
}

/** Join the program's day with each exercise's last completed sets to get suggestions. */
export async function buildPlan(program: Program, dayIndex: number, d: WorkoutDB = db): Promise<PlannedSlot[]> {
  const day = program.days[dayIndex];
  if (!day) return [];
  const out: PlannedSlot[] = [];
  for (const slot of day.slots) {
    const exercise = await d.exercises.get(slot.exerciseId);
    if (!exercise) continue;
    out.push(await planSlot(slot, exercise, d));
  }
  return out;
}
