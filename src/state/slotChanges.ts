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

  return d.transaction('rw', d.sessions, d.setLogs, d.programs, async () => {
    const session = await d.sessions.get(req.sessionId);
    if (!session || session.completed) throw new Error('This session is no longer in progress');
    const index = replaceSlotId ? session.plan.findIndex((s) => s.slotId === replaceSlotId) : -1;
    if (replaceSlotId && index < 0) throw new Error('That exercise is no longer in this session');
    const old = index >= 0 ? session.plan[index] : null;
    if (session.plan.some((s, i) => i !== index && s.exerciseId === exercise.id)) throw new Error(`${exercise.name} is already in this session`);

    const slot: Slot = { id: old?.slotId ?? newId(), exerciseId: exercise.id, ...req.spec };
    const planned: PlannedSlot = {
      ...(await planSlot(slot, exercise, d)),
      change: { kind: old ? 'swap' : 'add', scope: req.scope, ...(old ? { replaced: old.exerciseName } : {}) },
    };

    if (req.scope === 'program') await writeToProgram(session, slot, d);

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
  const slots = at >= 0 ? day.slots.map((s, i) => (i === at ? slot : s)) : [...day.slots, slot];
  const next: Program = { ...program, days: program.days.map((x) => (x.id === day.id ? { ...x, slots } : x)) };
  validateProgram(next);
  await d.programs.put(next);
}

/** The spec a swap dialog starts from: the slot as it is now. */
export function specOf(slot: PlannedSlot): SlotSpec {
  const t = slot.suggestion.repTarget;
  return t.kind === 'fixed'
    ? { sets: slot.sets, progression: 'single', targetReps: t.reps, targetRpe: slot.suggestion.targetRpe }
    : { sets: slot.sets, progression: 'double', repMin: t.min, repMax: t.max, targetRpe: slot.suggestion.targetRpe };
}

