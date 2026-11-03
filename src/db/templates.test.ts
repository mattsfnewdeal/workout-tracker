import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildPlan } from '../state/plan';
import { WorkoutDB } from './db';
import { abandonSession, checkFinish, findOrCreateExercise, finishSession, setWarmupDone, startSession, updateSetLog } from './ops';
import { getActiveProgram, getArchivedPrograms, getInProgressSession, getSessionLogs } from './queries';
import { PRELOADED, loadTemplate } from './templates';

let d: WorkoutDB;
beforeEach(() => {
  d = new WorkoutDB(`test-${Math.random().toString(36).slice(2)}`);
});

describe('preloaded program', () => {
  it('loads the Tuesday / Thursday program with checkbox warm-ups and no loads', async () => {
    const p = await loadTemplate(PRELOADED, d);
    const active = (await getActiveProgram(d))!;
    expect(active.id).toBe(p.id);
    expect(active.days.map((x) => x.name)).toEqual(['Tuesday', 'Thursday']);
    expect(active.days[0].warmups!.map((w) => w.name)).toEqual(['90/90 hips', 'Open books', 'Jump', 'Underhand Scoop']);
    expect(active.days[1].warmups!.map((w) => w.name)).toEqual(['90/90 hips', 'Open books', 'Jump', 'Step-through Put']);
    expect(active.days[0].warmups![3].note).toBe('3 × 4 with 4–6 kg');
    expect(active.days[0].warmups![2].note).toBe('3 × 5');
    expect(active.days[0].warmups![0].note).toBeUndefined();

    const tue = await buildPlan(active, 0, d);
    expect(tue.map((s) => [s.exerciseName, s.sets, s.suggestion.repTarget])).toEqual([
      ['Squat', 3, { kind: 'range', min: 4, max: 6, beat: null }],
      ['DB Bench', 3, { kind: 'range', min: 6, max: 8, beat: null }],
      ['DB SLDL', 3, { kind: 'fixed', reps: 10 }],
      ['Chin', 3, { kind: 'range', min: 6, max: 10, beat: null }],
      ['Pallof Press', 3, { kind: 'fixed', reps: 10 }],
      ['DB Incline Curl', 2, { kind: 'range', min: 12, max: 15, beat: null }],
    ]);
    expect(tue.every((s) => s.suggestion.load === null && s.suggestion.reason === 'first-session' && s.suggestion.targetRpe === 8)).toBe(true);
    const thu = await buildPlan(active, 1, d);
    expect(thu.map((s) => [s.exerciseName, s.sets, s.suggestion.repTarget])).toEqual([
      ['Trap', 3, { kind: 'range', min: 4, max: 6, beat: null }],
      ['DB Press', 3, { kind: 'range', min: 8, max: 10, beat: null }],
      ['BSS', 3, { kind: 'fixed', reps: 8 }],
      ['DB Row', 3, { kind: 'fixed', reps: 10 }],
      ['Cable chop', 3, { kind: 'fixed', reps: 10 }],
      ['DB OTE', 2, { kind: 'range', min: 12, max: 15, beat: null }],
    ]);
    expect(await d.exercises.count()).toBe(12);
    expect((await d.exercises.toArray()).every((e) => e.loadIncrement === 5)).toBe(true);
    expect(active.days.flatMap((day) => day.slots).every((s) => !('startingLoad' in s))).toBe(true);
  });

  it('reuses an existing exercise by name and archives the previous program', async () => {
    const squat = await findOrCreateExercise('squat', 2.5, d);
    const first = await loadTemplate(PRELOADED, d);
    const second = await loadTemplate(PRELOADED, d);
    expect((await getActiveProgram(d))!.id).toBe(second.id);
    expect((await getArchivedPrograms(d)).map((p) => p.id)).toEqual([first.id]);
    expect(second.days[0].slots[0].exerciseId).toBe(squat.id);
    expect(await d.exercises.count()).toBe(12);
  });
});

describe('warm-ups in a session', () => {
  it('are snapshotted unticked, persist when ticked, and never block Finish', async () => {
    const p = await loadTemplate(PRELOADED, d);
    const plan = await buildPlan(p, 0, d);
    const session = await startSession(p, 0, plan, d);
    expect(session.warmups!.map((w) => [w.name, w.done])).toEqual([['90/90 hips', false], ['Open books', false], ['Jump', false], ['Underhand Scoop', false]]);
    await setWarmupDone(session.id, session.warmups![0].id, true, d);
    await setWarmupDone(session.id, session.warmups![2].id, true, d);
    const fresh = new WorkoutDB(d.name);
    expect((await fresh.sessions.get(session.id))!.warmups!.map((w) => w.done)).toEqual([true, false, true, false]);

    const squatId = p.days[0].slots[0].exerciseId;
    const logs = await getSessionLogs(session.id, d);
    for (const l of logs.filter((x) => x.exerciseId === squatId)) await updateSetLog(l.id, { load: 185, reps: 5, rpe: l.setNumber === 1 ? 7 : undefined }, d);
    const check = checkFinish(session, await getSessionLogs(session.id, d));
    expect(check.problems).toEqual([]);
    expect(check.skipped).toHaveLength(5);
    await finishSession(session.id, d);
    const done = (await d.sessions.get(session.id))!;
    expect(done.completed).toBe(1);
    expect(done.warmups!.filter((w) => w.done).map((w) => w.name)).toEqual(['90/90 hips', 'Jump']);
  });

  it('a day built before v1.3 (no warmups field) starts a session with an empty list', async () => {
    const p = await loadTemplate(PRELOADED, d);
    delete p.days[0].warmups;
    await d.programs.put(p);
    const plan = await buildPlan(p, 0, d);
    const session = await startSession(p, 0, plan, d);
    expect(session.warmups).toEqual([]);
    await abandonSession(session.id, d);
    expect(await getInProgressSession(d)).toBeNull();
  });
});
