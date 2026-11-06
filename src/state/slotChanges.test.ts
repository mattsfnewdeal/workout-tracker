import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkoutDB } from '../db/db';
import { checkFinish, createProgram, emptyProgram, findOrCreateExercise, finishSession, newSlot, startSession, updateSetLog } from '../db/ops';
import { getActiveProgram, getExercisesWithHistory, getLastCompletedSets, getSessionLogs } from '../db/queries';
import type { Program, Session } from '../model/types';
import { buildPlan } from './plan';
import { addExercise, specOf, swapExercise } from './slotChanges';

let d: WorkoutDB;
let squatId: string;
let benchId: string;
let pressId: string;
let program: Program;

/** Day A: Squat 3×5 @8, Bench 3×5 @8. Day B: Squat 3×6–8 @8. Leg Press exists but is on no day. */
beforeEach(async () => {
  d = new WorkoutDB(`test-${Math.random().toString(36).slice(2)}`);
  squatId = (await findOrCreateExercise('Squat', 5, d)).id;
  benchId = (await findOrCreateExercise('Bench Press', 5, d)).id;
  pressId = (await findOrCreateExercise('Leg Press', 10, d)).id;
  program = emptyProgram('Block 1');
  program.days[0].slots.push(newSlot(squatId, { sets: 3, progression: 'single', targetReps: 5 }));
  program.days[0].slots.push(newSlot(benchId, { sets: 3, progression: 'single', targetReps: 5 }));
  program.days[1].slots.push(newSlot(squatId, { sets: 3, progression: 'double', repMin: 6, repMax: 8 }));
  await createProgram(program, d);
});

async function startNext(): Promise<Session> {
  const prog = (await getActiveProgram(d))!;
  return startSession(prog, prog.nextDayIndex, await buildPlan(prog, prog.nextDayIndex, d), d);
}

async function logAll(session: Session, exerciseId: string, rows: [number, number, number | null][]) {
  const logs = await getSessionLogs(session.id, d);
  for (const [i, [load, reps, rpe]] of rows.entries()) {
    const log = logs.find((l) => l.exerciseId === exerciseId && l.setNumber === i + 1)!;
    await updateSetLog(log.id, { load, reps, rpe: rpe ?? undefined }, d);
  }
}

const RANGE_4_6 = { sets: 3, progression: 'double' as const, repMin: 4, repMax: 6, targetRpe: 8 };

describe('swap, this session only', () => {
  it('replaces the slot in place, keeps its id, recreates its rows, and leaves the program alone', async () => {
    const session = await startNext();
    const squatSlot = session.plan[0];
    await logAll(session, squatId, [[225, 5, 7]]);

    const after = await swapExercise({ sessionId: session.id, slotId: squatSlot.slotId, exerciseId: pressId, spec: RANGE_4_6, scope: 'session' }, d);
    expect(after.plan.map((s) => s.exerciseName)).toEqual(['Leg Press', 'Bench Press']);
    const swapped = after.plan[0];
    expect(swapped.slotId).toBe(squatSlot.slotId);
    expect(swapped.increment).toBe(10);
    expect(swapped.suggestion).toMatchObject({ load: null, reason: 'first-session', repTarget: { kind: 'range', min: 4, max: 6 } });
    expect(swapped.change).toEqual({ kind: 'swap', scope: 'session', replaced: 'Squat' });

    const stored = (await d.sessions.get(session.id))!;
    expect(stored.plan).toEqual(after.plan);
    const rows = await getSessionLogs(session.id, d);
    const slotRows = rows.filter((l) => l.slotId === squatSlot.slotId);
    expect(slotRows.map((l) => [l.exerciseId, l.setNumber, l.load, l.reps])).toEqual([[pressId, 1, undefined, undefined], [pressId, 2, undefined, undefined], [pressId, 3, undefined, undefined]]);
    expect(rows.some((l) => l.exerciseId === squatId)).toBe(false);

    const prog = (await getActiveProgram(d))!;
    expect(prog.days[0].slots.map((s) => s.exerciseId)).toEqual([squatId, benchId]);
    expect(checkFinish(after, rows).skipped).toEqual(['Leg Press', 'Bench Press']);
  });

  it('a swapped-in exercise with history gets a real suggestion', async () => {
    const first = await startNext();
    await logAll(first, squatId, [[225, 5, 7], [225, 5, 7], [225, 5, 7]]);
    await logAll(first, benchId, [[135, 5, 7], [135, 5, 7], [135, 5, 7]]);
    await finishSession(first.id, d);

    const dayB = await startNext();
    expect(dayB.dayName).toBe('Day B');
    const after = await swapExercise({
      sessionId: dayB.id, slotId: dayB.plan[0].slotId, exerciseId: benchId,
      spec: { sets: 3, progression: 'single', targetReps: 5, targetRpe: 8 }, scope: 'session',
    }, d);
    // 135×5@7 → e1RM 171.8 → 5@8 = 135.0 → +1% floor 136.35 → rounds to 135 → bump to 140
    expect(after.plan[0].suggestion).toMatchObject({ load: 140, reason: 'single-progress' });
    const rows = await getSessionLogs(dayB.id, d);
    expect(rows.filter((l) => l.exerciseId === benchId).map((l) => l.load)).toEqual([140, 140, 140]);

    await logAll(dayB, benchId, [[140, 5, 8], [140, 5, 8], [140, 5, 8]]);
    await finishSession(dayB.id, d);
    expect((await getLastCompletedSets(benchId, d))!.sets[0]).toMatchObject({ load: 140, reps: 5, rpe: 8 });
    expect((await getLastCompletedSets(squatId, d))!.sets[0]).toMatchObject({ load: 225, reps: 5, rpe: 7 });
  });

  it('refuses an exercise already in the session, a finished session, and a bad spec', async () => {
    const session = await startNext();
    const slotId = session.plan[0].slotId;
    await expect(swapExercise({ sessionId: session.id, slotId, exerciseId: benchId, spec: RANGE_4_6, scope: 'session' }, d)).rejects.toThrow(/already in this session/);
    await expect(swapExercise({ sessionId: session.id, slotId, exerciseId: pressId, spec: { ...RANGE_4_6, sets: 0 }, scope: 'session' }, d)).rejects.toThrow(/Sets must be at least 1/);
    await expect(swapExercise({ sessionId: session.id, slotId, exerciseId: pressId, spec: { ...RANGE_4_6, repMax: 4 }, scope: 'session' }, d)).rejects.toThrow(/rep range must be like/i);
    await expect(swapExercise({ sessionId: session.id, slotId: 'nope', exerciseId: pressId, spec: RANGE_4_6, scope: 'session' }, d)).rejects.toThrow(/no longer in this session/);
    await expect(addExercise({ sessionId: session.id, exerciseId: 'nope', spec: RANGE_4_6, scope: 'session' }, d)).rejects.toThrow(/Exercise not found/);
    const rows = await getSessionLogs(session.id, d);
    expect(rows).toHaveLength(6);
  });

  it('swapping an exercise for itself just changes the scheme', async () => {
    const session = await startNext();
    const after = await swapExercise({ sessionId: session.id, slotId: session.plan[0].slotId, exerciseId: squatId, spec: { ...RANGE_4_6, sets: 4 }, scope: 'session' }, d);
    expect(after.plan[0]).toMatchObject({ exerciseName: 'Squat', sets: 4, change: { kind: 'swap', replaced: 'Squat' } });
    expect((await getSessionLogs(session.id, d)).filter((l) => l.exerciseId === squatId)).toHaveLength(4);
  });
});

describe('swap, this and future sessions', () => {
  it('rewrites the program slot in place with the new exercise and scheme', async () => {
    const session = await startNext();
    const squatSlot = session.plan[0];
    await swapExercise({ sessionId: session.id, slotId: squatSlot.slotId, exerciseId: pressId, spec: RANGE_4_6, scope: 'program' }, d);
    const prog = (await getActiveProgram(d))!;
    expect(prog.days[0].slots.map((s) => s.exerciseId)).toEqual([pressId, benchId]);
    expect(prog.days[0].slots[0]).toEqual({ id: squatSlot.slotId, exerciseId: pressId, ...RANGE_4_6 });
    expect(prog.days[1].slots.map((s) => s.exerciseId)).toEqual([squatId]);
    expect((await d.sessions.get(session.id))!.plan[0].change).toEqual({ kind: 'swap', scope: 'program', replaced: 'Squat' });

    // the next Day A is built from the rewritten program
    await finishSession(session.id, d);
    await finishSession((await startNext()).id, d);
    const nextA = await buildPlan((await getActiveProgram(d))!, 0, d);
    expect(nextA.map((s) => s.exerciseName)).toEqual(['Leg Press', 'Bench Press']);
    expect(nextA[0].change).toBeUndefined();
  });

  it('a second swap on the same slot still replaces the same program slot', async () => {
    const session = await startNext();
    const slotId = session.plan[0].slotId;
    await swapExercise({ sessionId: session.id, slotId, exerciseId: pressId, spec: RANGE_4_6, scope: 'session' }, d);
    const hack = await findOrCreateExercise('Hack Squat', 5, d);
    await swapExercise({ sessionId: session.id, slotId, exerciseId: hack.id, spec: RANGE_4_6, scope: 'program' }, d);
    const prog = (await getActiveProgram(d))!;
    expect(prog.days[0].slots.map((s) => s.exerciseId)).toEqual([hack.id, benchId]);
  });

  it('rejects a duplicate on the program day even when the session snapshot differs', async () => {
    const session = await startNext();
    // Bench was removed from the session (swapped out, session only) but is still on Day A in the program.
    await swapExercise({ sessionId: session.id, slotId: session.plan[1].slotId, exerciseId: pressId, spec: RANGE_4_6, scope: 'session' }, d);
    await expect(
      swapExercise({ sessionId: session.id, slotId: session.plan[0].slotId, exerciseId: benchId, spec: RANGE_4_6, scope: 'program' }, d),
    ).rejects.toThrow(/twice/);
    // nothing changed
    expect((await d.sessions.get(session.id))!.plan.map((s) => s.exerciseId)).toEqual([squatId, pressId]);
    expect((await getActiveProgram(d))!.days[0].slots.map((s) => s.exerciseId)).toEqual([squatId, benchId]);
  });

  it('falls back to appending when the program slot was deleted mid-session', async () => {
    const session = await startNext();
    const prog = (await getActiveProgram(d))!;
    await d.programs.put({ ...prog, days: prog.days.map((x, i) => (i === 0 ? { ...x, slots: x.slots.slice(1) } : x)) });
    await swapExercise({ sessionId: session.id, slotId: session.plan[0].slotId, exerciseId: pressId, spec: RANGE_4_6, scope: 'program' }, d);
    expect((await getActiveProgram(d))!.days[0].slots.map((s) => s.exerciseId)).toEqual([benchId, pressId]);
  });
});

describe('add', () => {
  it('this session only: appends to the plan with rows, program untouched, and the exercise reaches History once finished', async () => {
    const session = await startNext();
    const after = await addExercise({ sessionId: session.id, exerciseId: pressId, spec: RANGE_4_6, scope: 'session' }, d);
    expect(after.plan.map((s) => s.exerciseName)).toEqual(['Squat', 'Bench Press', 'Leg Press']);
    expect(after.plan[2].change).toEqual({ kind: 'add', scope: 'session' });
    expect((await getSessionLogs(session.id, d)).filter((l) => l.slotId === after.plan[2].slotId)).toHaveLength(3);
    expect((await getActiveProgram(d))!.days[0].slots).toHaveLength(2);

    await logAll(session, pressId, [[300, 6, 8], [300, 5, 8], [300, 5, 9]]);
    await finishSession(session.id, d);
    expect((await getExercisesWithHistory(d)).map((e) => e.name)).toEqual(['Leg Press']);
    expect((await getLastCompletedSets(pressId, d))!.sets).toHaveLength(3);
  });

  it('this and future sessions: appends to the program day too', async () => {
    const session = await startNext();
    await addExercise({ sessionId: session.id, exerciseId: pressId, spec: RANGE_4_6, scope: 'program' }, d);
    const prog = (await getActiveProgram(d))!;
    expect(prog.days[0].slots.map((s) => s.exerciseId)).toEqual([squatId, benchId, pressId]);
    expect(prog.days[0].slots[2]).toMatchObject(RANGE_4_6);
    expect(prog.days[1].slots).toHaveLength(1);
  });

  it('refuses an exercise already in the session', async () => {
    const session = await startNext();
    await expect(addExercise({ sessionId: session.id, exerciseId: squatId, spec: RANGE_4_6, scope: 'session' }, d)).rejects.toThrow(/already in this session/);
  });
});

describe('specOf', () => {
  it('reads the slot back out of a planned slot', async () => {
    const session = await startNext();
    expect(specOf(session.plan[0])).toEqual({ sets: 3, progression: 'single', targetReps: 5, targetRpe: 8 });
    await finishSession(session.id, d);
    const dayB = await startNext();
    expect(specOf(dayB.plan[0])).toEqual({ sets: 3, progression: 'double', repMin: 6, repMax: 8, targetRpe: 8 });
  });
});
