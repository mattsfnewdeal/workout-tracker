import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkoutDB } from './db';
import { checkFinish, createProgram, emptyProgram, findOrCreateExercise, finishSession, newSlot, setWarmupSetDone, startSession, updateExercise, updateSetLog } from './ops';
import { getActiveProgram, getExerciseHistory, getLastCompletedSets, getSessionLogs } from './queries';
import { buildPlan } from '../state/plan';
import { swapExercise } from '../state/slotChanges';
import { PRELOADED, loadTemplate } from './templates';

let d: WorkoutDB;
beforeEach(() => {
  d = new WorkoutDB(`test-${Math.random().toString(36).slice(2)}`);
});

async function startTuesday() {
  const p = (await getActiveProgram(d))!;
  return startSession(p, 0, await buildPlan(p, 0, d), d);
}

describe('bodyweight exercises', () => {
  it('the preloaded Chin is bodyweight; its rows start empty and finish as a 0 load', async () => {
    await loadTemplate(PRELOADED, d);
    const session = await startTuesday();
    const chin = session.plan.find((s) => s.exerciseName === 'Chin')!;
    expect(chin.bodyweight).toBe(true);
    expect(session.plan.find((s) => s.exerciseName === 'Squat')!.bodyweight).toBeUndefined();

    const rows = (await getSessionLogs(session.id, d)).filter((l) => l.slotId === chin.slotId);
    expect(rows.every((l) => l.load == null)).toBe(true);
    for (const l of rows) await updateSetLog(l.id, { reps: 8, rpe: l.setNumber === 1 ? 8 : undefined }, d);
    const check = checkFinish(session, await getSessionLogs(session.id, d));
    expect(check.problems).toEqual([]);
    expect(check.skipped).not.toContain('Chin');

    await finishSession(session.id, d);
    const last = (await getLastCompletedSets(chin.exerciseId, d))!;
    expect(last.sets.map((s) => [s.load, s.reps, s.rpe])).toEqual([[0, 8, 8], [0, 8, null], [0, 8, null]]);
    const history = await getExerciseHistory(chin.exerciseId, d);
    expect(history).toHaveLength(1);
    expect(history[0].e1rm).toBeNull();

    // Next Tuesday: hold at bodyweight, beat 8; no e1RM, normal confidence, one bodyweight warm-up set
    await finishSession((await startSession((await getActiveProgram(d))!, 1, await buildPlan((await getActiveProgram(d))!, 1, d), d)).id, d);
    const next = (await buildPlan((await getActiveProgram(d))!, 0, d)).find((s) => s.exerciseName === 'Chin')!;
    expect(next.suggestion).toMatchObject({ load: 0, reason: 'double-hold-add-reps', confidence: 'normal', repTarget: { beat: 8 } });
    expect(next.warmupSets).toEqual([{ load: 0, reps: 5, done: false }]);
    const again = await startTuesday();
    const chinRows = (await getSessionLogs(again.id, d)).filter((l) => l.slotId === chin.slotId);
    expect(chinRows.every((l) => l.load == null && l.suggestedLoad === 0)).toBe(true);
  });

  it('added weight is a load; a negative one is refused; a non-bodyweight slot still needs a load', async () => {
    const chin = await findOrCreateExercise('Chin', 5, d);
    await updateExercise(chin.id, { bodyweight: true }, d);
    const squat = await findOrCreateExercise('Squat', 5, d);
    const p = emptyProgram('BW');
    p.days[0].slots.push(newSlot(chin.id, { sets: 2, progression: 'double', repMin: 6, repMax: 10 }), newSlot(squat.id, { sets: 1 }));
    await createProgram(p, d);
    const session = await startTuesday();
    const logs = await getSessionLogs(session.id, d);
    const [c1, c2] = logs.filter((l) => l.exerciseId === chin.id);
    const [s1] = logs.filter((l) => l.exerciseId === squat.id);
    await updateSetLog(c1.id, { load: 25, reps: 11, rpe: 8 }, d);
    await updateSetLog(c2.id, { load: -5, reps: 8 }, d);
    await updateSetLog(s1.id, { reps: 5, rpe: 8 }, d);
    expect(checkFinish(session, await getSessionLogs(session.id, d)).problems).toEqual(["Chin set 2: added weight can't be negative", 'Squat set 1: enter the load']);
    await updateSetLog(c2.id, { load: undefined }, d);
    await updateSetLog(s1.id, { load: 0 }, d);
    expect(checkFinish(session, await getSessionLogs(session.id, d)).problems).toEqual(['Squat set 1: load must be above 0']);
    await updateSetLog(s1.id, { load: 225 }, d);
    await finishSession(session.id, d);
    expect((await getLastCompletedSets(chin.id, d))!.sets.map((s) => s.load)).toEqual([25, 0]);
    expect((await buildPlan((await getActiveProgram(d))!, 0, d))[0].suggestion).toMatchObject({ load: 30, reason: 'double-progress' });
    expect((await buildPlan((await getActiveProgram(d))!, 0, d))[0].warmupSets).toEqual([{ load: 0, reps: 5, done: false }, { load: 20, reps: 3, done: false }]);
  });
});

describe('suggested warm-up sets', () => {
  it('absent on a first session, present once there is a working load, ticks persist, and a swap recomputes them', async () => {
    const squat = await findOrCreateExercise('Squat', 5, d);
    const bench = await findOrCreateExercise('DB Bench', 5, d);
    const curl = await findOrCreateExercise('DB Incline Curl', 5, d);
    const p = emptyProgram('W');
    p.days[0].slots.push(newSlot(squat.id, { sets: 3, targetReps: 5 }), newSlot(bench.id, { sets: 3, progression: 'double', repMin: 6, repMax: 8 }), newSlot(curl.id, { sets: 2, progression: 'double', repMin: 12, repMax: 15 }));
    await createProgram(p, d);

    const first = await startTuesday();
    expect(first.plan.every((s) => s.warmupSets === undefined)).toBe(true);
    const logs = await getSessionLogs(first.id, d);
    const loads: Record<string, [number, number]> = { [squat.id]: [225, 5], [bench.id]: [70, 7], [curl.id]: [30, 13] };
    for (const l of logs) await updateSetLog(l.id, { load: loads[l.exerciseId][0], reps: loads[l.exerciseId][1], rpe: l.setNumber === 1 ? 7 : undefined }, d);
    await finishSession(first.id, d);
    await finishSession((await startSession((await getActiveProgram(d))!, 1, [], d)).id, d);

    const plan = await buildPlan((await getActiveProgram(d))!, 0, d);
    expect(plan[0].suggestion.load).toBe(230);
    expect(plan[0].warmupSets).toEqual([{ load: 90, reps: 5, done: false }, { load: 140, reps: 5, done: false }, { load: 185, reps: 3, done: false }]);
    expect(plan[1].suggestion.load).toBe(70);
    expect(plan[1].warmupSets).toEqual([{ load: 40, reps: 6, done: false }]);
    expect(plan[2].warmupSets).toEqual([]);

    const session = await startTuesday();
    await setWarmupSetDone(session.id, plan[0].slotId, 1, true, d);
    await setWarmupSetDone(session.id, plan[0].slotId, 9, true, d); // out of range: ignored
    const stored = (await new WorkoutDB(d.name).sessions.get(session.id))!;
    expect(stored.plan[0].warmupSets!.map((w) => w.done)).toEqual([false, true, false]);
    expect(stored.plan[1].warmupSets!.map((w) => w.done)).toEqual([false]);

    const swapped = await swapExercise({ sessionId: session.id, slotId: plan[2].slotId, exerciseId: squat.id, spec: { sets: 3, progression: 'single', targetReps: 3, targetRpe: 8 }, scope: 'session' }, d).catch((e: Error) => e);
    expect(swapped).toBeInstanceOf(Error); // squat is already in the session
    const press = await findOrCreateExercise('Press', 5, d);
    const after = await swapExercise({ sessionId: session.id, slotId: plan[2].slotId, exerciseId: press.id, spec: { sets: 3, progression: 'single', targetReps: 5, targetRpe: 8 }, scope: 'session' }, d);
    expect(after.plan[2].warmupSets).toBeUndefined(); // first session for Press
  });
});
