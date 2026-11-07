import { db, type WorkoutDB } from '../db/db';
import { newId, setRowsFor, slotProblem, validateProgram } from '../db/ops';
import type { ChangeScope, PlannedSlot, Program, Session, Slot, SlotSpec } from '../model/types';
import { planSlot } from './plan';

export interface SlotChangeRequest {
  sessionId: string;
  exerciseId: string;
  spec: SlotSpec;
  /** 'session': only this session's plan changes. 'program': the program's day is edited too, so every future session has it. */
  scope: ChangeScope;
  /** When given, the exercise's bodyweight flag is set to this in the same transaction (so a refused change leaves it alone). */
  bodyweight?: boolean;
}

/**
 * Replace the exercise in one slot of an in-progress session. The slot keeps its id and position;
 * any sets already logged for it are discarded and fresh rows are created with the new exercise's suggestion.
 */
export function swapExercise(req: SlotChangeRequest & { slotId: string }, d: WorkoutDB = db): Promise<Session> {
  return applySlotChange(req, req.slotId, d);
}

/** Append an exercise to an in-progress session. */
export function addExercise(req: SlotChangeRequest, d: WorkoutDB = db): Promise<Session> {
  return applySlotChange(req, null, d);
}

async function applySlotChange(req: SlotChangeRequest, replaceSlotId: string | null, d: WorkoutDB): Promise<Session> {
  const problem = slotProblem(req.spec);
  if (problem) throw new Error(problem.charAt(0).toUpperCase() + problem.slice(1));
  const exercise = await d.exercises.get(req.exerciseId);
  if (!exercise) throw new Error('Exercise not found');

  return d.transaction('rw', d.sessions, d.setLogs, d.programs, d.exercises, async () => {
    const session = await d.sessions.get(req.sessionId);
    if (!session || session.completed) throw new Error('This session is no longer in progress');
    const index = replaceSlotId ? session.plan.findIndex((s) => s.slotId === replaceSlotId) : -1;
    if (replaceSlotId && index < 0) throw new Error('That exercise is no longer in this session');
    const old = index >= 0 ? session.plan[index] : null;
    if (session.plan.some((s, i) => i !== index && s.exerciseId === exercise.id)) throw new Error(`${exercise.name} is already in this session`);

    const superset = !!old?.supersetWithPrev;
    // A swap made during the intro weeks keeps the intro count when the full count wasn't changed in the dialog (which is seeded with it).
    const inIntro = old?.fullSets != null;
    const introSets = inIntro && req.spec.sets === old.fullSets ? old.sets : undefined;
    const slot: Slot = {
      id: old?.slotId ?? newId(),
      exerciseId: exercise.id,
      ...req.spec,
      ...(superset ? { supersetWithPrev: true } : {}),
      ...(introSets != null ? { introSets } : {}),
    };
    if (req.scope === 'program') await writeToProgram(session, slot, d); // validated before anything else is written
    const flagged = req.bodyweight != null && !!exercise.bodyweight !== req.bodyweight ? { ...exercise, bodyweight: req.bodyweight } : exercise;
    if (flagged !== exercise) await d.exercises.update(exercise.id, { bodyweight: req.bodyweight });
    const planned: PlannedSlot = {
      ...(await planSlot(slot, flagged, d, { supersetWithPrev: superset, intro: inIntro })),
      change: { kind: old ? 'swap' : 'add', scope: req.scope, ...(old ? { replaced: old.exerciseName } : {}) },
    };

    const plan = [...session.plan];
    if (old) {
      plan[index] = planned;
      await d.setLogs.where('sessionId').equals(session.id).and((l) => l.slotId === old.slotId).delete();
    } else {
      plan.push(planned);
    }
    await d.setLogs.bulkAdd(setRowsFor(session.id, planned));
    await d.sessions.update(session.id, { plan });
    return { ...session, plan };
  });
}

/** Put the slot into the session's day on the live program: in place when the day still has a slot with that id, else at the end. */
async function writeToProgram(session: Session, slot: Slot, d: WorkoutDB): Promise<void> {
  const program = await d.programs.get(session.programId);
  if (!program || program.status !== 'active') throw new Error('This session’s program is no longer active; apply it to just this session');
  const day = program.days.find((x) => x.id === session.dayId);
  if (!day) throw new Error(`${session.dayName} is no longer in the program; apply it to just this session`);
  const at = day.slots.findIndex((s) => s.id === slot.id);
  // In place, the slot keeps its place in a superset. The intro count travels on `slot` when the swap kept the full count.
  const slots = at >= 0 ? day.slots.map((s, i) => (i === at ? { ...slot, ...(s.supersetWithPrev ? { supersetWithPrev: true } : {}) } : s)) : [...day.slots, slot];
  const next: Program = { ...program, days: program.days.map((x) => (x.id === day.id ? { ...x, slots } : x)) };
  validateProgram(next);
  await d.programs.put(next);
}

/** The spec a swap dialog starts from: the slot as it is now. */
export function specOf(slot: PlannedSlot): SlotSpec {
  const t = slot.suggestion.repTarget;
  const extra = {
    ...(slot.rule === 'linear' || slot.rule === 'manual' ? { rule: slot.rule } : {}),
    ...(slot.targetRpe != null ? { targetRpe: slot.targetRpe } : {}),
    ...(slot.note ? { note: slot.note } : {}),
  };
  const sets = slot.fullSets ?? slot.sets; // the dialog shows the full count; the intro count is carried by the swap
  return t.kind === 'fixed'
    ? { sets, progression: 'single', targetReps: t.reps, ...extra }
    : { sets, progression: 'double', repMin: t.min, repMax: t.max, ...extra };
}

