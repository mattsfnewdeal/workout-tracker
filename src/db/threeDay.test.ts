import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkoutDB } from './db';
import { checkFinish, findOrCreateExercise, finishSession, startSession, updateSetLog, validateProgram } from './ops';
import { getActiveProgram, getRecentCompletedSets, getSessionLogs } from './queries';
import { buildPlan, inIntroWeeks, introEndsAt, supersetGroups } from '../state/plan';
import { specOf, swapExercise } from '../state/slotChanges';
import { loadTemplate } from './templates';
import { THREE_DAY } from './templateFixtures';

let d: WorkoutDB;
beforeEach(() => {
  d = new WorkoutDB(`test-${Math.random().toString(36).slice(2)}`);
});

const WEEK = 7 * 24 * 3600 * 1000;

describe('3x Lifting template', () => {
  it('loads three days with linear main lifts, intro set counts, supersets and increments', async () => {
    const p = await loadTemplate(THREE_DAY, d);
    expect(p.introWeeks).toBe(2);
    expect(p.days.map((x) => x.name)).toEqual(['Day 1', 'Day 2', 'Day 3']);
    expect(() => validateProgram(p)).not.toThrow();
    const exercises = await d.exercises.toArray();
    const inc = (name: string) => exercises.find((e) => e.name === name)!.loadIncrement;
    expect([inc('Back Squat'), inc('Bench Press'), inc('Deadlift'), inc('Overhead Press'), inc('Curl')]).toEqual([5, 5, 10, 2.5, 5]);
    expect(exercises.find((e) => e.name === 'Ab Wheel')!.bodyweight).toBe(true);
    expect(exercises.filter((e) => e.name === 'Face Pull')).toHaveLength(1); // shared between Day 1 and Day 3
    expect(exercises.filter((e) => e.name === 'Lateral Raise')).toHaveLength(1); // same exercise on Day 1 and Day 3
    expect(exercises).toHaveLength(19);
    // main lifts have no RPE goal; accessories keep 8; a by-RPE slot without a goal is invalid
    expect(p.days[0].slots.slice(0, 2).map((s) => s.targetRpe)).toEqual([undefined, undefined]);
    expect(p.days[0].slots.slice(2).every((s) => s.targetRpe === 8)).toBe(true);
    const bad = { ...p, days: [{ ...p.days[0], slots: [{ ...p.days[0].slots[0], rule: undefined }] }] };
    expect(() => validateProgram(bad)).toThrow(/needs an RPE goal/);
    const plan = await buildPlan(p, 0, d);
    expect(plan[0].targetRpe).toBeUndefined();
    expect(plan[2].targetRpe).toBe(8);

    const day2 = p.days[1].slots;
    expect(day2.map((s) => [s.sets, s.introSets ?? null, !!s.supersetWithPrev, s.rule])).toEqual([
      [2, null, false, 'linear'], [3, null, false, 'linear'], [3, 2, false, 'linear'], [4, 2, false, 'linear'],
      [3, 2, true, 'linear'], [3, 2, false, 'linear'], [3, 2, true, 'linear'], [3, 2, false, 'linear'],
    ]);
  });

  it('intro weeks: reduced sets for two weeks from creation, then the full counts', async () => {
    const p = await loadTemplate(THREE_DAY, d);
    expect(inIntroWeeks(p, p.createdAt)).toBe(true);
    expect(inIntroWeeks(p, p.createdAt + 2 * WEEK - 1)).toBe(true);
    expect(inIntroWeeks(p, p.createdAt + 2 * WEEK)).toBe(false);
    // week 0: the intro clock starts later; sessions before it still use the intro counts
    const later = { ...p, introStartsAt: p.createdAt + 3 * 86400000 };
    expect(introEndsAt(later)).toBe(p.createdAt + 3 * 86400000 + 2 * WEEK);
    expect(inIntroWeeks(later, p.createdAt)).toBe(true);
    expect(inIntroWeeks(later, p.createdAt + 2 * WEEK + 86400000)).toBe(true);
    expect(inIntroWeeks(later, p.createdAt + 3 * 86400000 + 2 * WEEK)).toBe(false);
    expect(introEndsAt({ ...p, introWeeks: undefined })).toBeNull();
    expect((await buildPlan(later, 0, d, p.createdAt + 2 * WEEK + 86400000))[2].sets).toBe(2);
    const intro = await buildPlan(p, 0, d, p.createdAt + WEEK);
    expect(intro.map((s) => [s.exerciseName, s.sets, s.fullSets ?? null])).toEqual([
      ['Back Squat', 3, null], ['Bench Press', 3, null], ['Chest-Supported Row', 2, 4], ['Romanian Deadlift', 2, 3],
      ['Lateral Raise', 2, 3], ['Face Pull', 2, null], ['Calf Raise', 2, 3],
    ]);
    const full = await buildPlan(p, 0, d, p.createdAt + 3 * WEEK);
    expect(full.map((s) => s.sets)).toEqual([3, 3, 4, 3, 3, 2, 3]);
    expect(full.every((s) => s.fullSets === undefined)).toBe(true);
    // a session started in the intro weeks pre-creates only the intro rows
    const session = await startSession(p, 0, intro, d);
    const logs = await getSessionLogs(session.id, d);
    expect(logs.filter((l) => l.slotId === intro[2].slotId)).toHaveLength(2);
  });

  it('supersets group consecutive marked slots; the second gets no warm-up sets', async () => {
    const p = await loadTemplate(THREE_DAY, d);
    const plan = await buildPlan(p, 2, d);
    expect(supersetGroups(plan).map((g) => g.map((s) => s.exerciseName))).toEqual([
      ['Back Squat'], ['Bench Press'], ['DB Reverse Lunge'], ['Cable Row', 'Leg Curl'], ['Overhead Extension', 'Hammer Curl'], ['Lateral Raise', 'Face Pull'],
    ]);
    expect(plan.find((s) => s.exerciseName === 'Leg Curl')!.supersetWithPrev).toBe(true);
    expect(supersetGroups([{ supersetWithPrev: true }, {}]).map((g) => g.length)).toEqual([1, 1]); // a leading flag is ignored

    // give Cable Row and Leg Curl history so warm-ups would apply, then check only A1 gets them
    const session = await startSession(p, 2, plan, d);
    const logs = await getSessionLogs(session.id, d);
    const row = plan.find((s) => s.exerciseName === 'Cable Row')!;
    const curl = plan.find((s) => s.exerciseName === 'Leg Curl')!;
    for (const l of logs.filter((x) => x.slotId === row.slotId)) await updateSetLog(l.id, { load: 120, reps: 12, rpe: l.setNumber === 1 ? 8 : undefined }, d);
    for (const l of logs.filter((x) => x.slotId === curl.slotId)) await updateSetLog(l.id, { load: 100, reps: 15, rpe: l.setNumber === 1 ? 8 : undefined }, d);
    await finishSession(session.id, d);
    const next = await buildPlan((await getActiveProgram(d))!, 2, d);
    const nextRow = next.find((s) => s.exerciseName === 'Cable Row')!;
    const nextCurl = next.find((s) => s.exerciseName === 'Leg Curl')!;
    expect(nextRow.suggestion).toMatchObject({ load: 125, reason: 'linear-progress' });
    expect(nextRow.warmupSets).toEqual([{ load: 75, reps: 8, done: false }, { load: 100, reps: 3, done: false }]);
    expect(nextCurl.suggestion).toMatchObject({ load: 105, reason: 'linear-progress' });
    expect(nextCurl.warmupSets).toBeUndefined();
  });

  it('linear main lift across three sessions: progress, hold, deload; swapping keeps the superset link', async () => {
    const p = await loadTemplate(THREE_DAY, d);
    const squatId = p.days[0].slots[0].exerciseId;
    const run = async (dayIndex: number, reps: number[], load: number) => {
      const prog = (await getActiveProgram(d))!;
      const plan = await buildPlan(prog, dayIndex, d);
      const session = await startSession(prog, dayIndex, plan, d);
      const logs = (await getSessionLogs(session.id, d)).filter((l) => l.exerciseId === squatId);
      expect(logs).toHaveLength(3);
      for (const l of logs) await updateSetLog(l.id, { load, reps: reps[l.setNumber - 1], rpe: l.setNumber === 1 ? 8 : undefined }, d);
      await finishSession(session.id, d);
      return plan;
    };
    await run(0, [5, 5, 5], 225);
    expect((await buildPlan((await getActiveProgram(d))!, 2, d))[0].suggestion).toMatchObject({ load: 230, reason: 'linear-progress' });
    await run(2, [5, 5, 4], 230);
    expect((await buildPlan((await getActiveProgram(d))!, 0, d))[0].suggestion).toMatchObject({ load: 230, reason: 'linear-hold-missed' });
    await run(0, [5, 4, 4], 230);
    expect((await buildPlan((await getActiveProgram(d))!, 2, d))[0].suggestion).toMatchObject({ load: 205, reason: 'linear-deload', confidence: 'normal' });
    expect((await getRecentCompletedSets(squatId, 2, d)).map((r) => r.sets[0].load)).toEqual([230, 230]);

    // swap A2 of a superset for just this session: it stays paired and keeps the linear rule the dialog offered
    const prog = (await getActiveProgram(d))!;
    const plan = await buildPlan(prog, 0, d);
    const session = await startSession(prog, 0, plan, d);
    const facePull = plan.find((s) => s.exerciseName === 'Face Pull')!;
    const after = await swapExercise({ sessionId: session.id, slotId: facePull.slotId, exerciseId: p.days[1].slots[5].exerciseId /* Curl */, spec: { sets: 2, progression: 'double', repMin: 10, repMax: 15, targetRpe: 8, rule: 'linear' }, scope: 'program' }, d);
    const swapped = after.plan.find((s) => s.slotId === facePull.slotId)!;
    expect(swapped).toMatchObject({ exerciseName: 'Curl', supersetWithPrev: true, rule: 'linear' });
    const day1 = (await getActiveProgram(d))!.days[0].slots;
    expect(day1[5]).toMatchObject({ exerciseId: p.days[1].slots[5].exerciseId, supersetWithPrev: true, rule: 'linear' });
    expect(day1[5].introSets).toBeUndefined(); // sets were changed in the dialog (2 vs the slot's 2 … but the session was past the intro: no fullSets)
    expect(checkFinish(after, await getSessionLogs(session.id, d)).skipped).toContain('Curl');
  });

  it('a program-scope swap during the intro weeks keeps the intro count and the full count', async () => {
    const p = await loadTemplate(THREE_DAY, d);
    const plan = await buildPlan(p, 1, d, p.createdAt + 86400000);
    const hlr = plan.find((s) => s.exerciseName === 'Ab Wheel')!;
    expect([hlr.sets, hlr.fullSets]).toEqual([2, 3]);
    expect(specOf(hlr).sets).toBe(3); // the dialog is seeded with the full count
    const session = await startSession(p, 1, plan, d);
    const wheel = await findOrCreateExercise('Hanging Leg Raise', 5, d);
    const after = await swapExercise({ sessionId: session.id, slotId: hlr.slotId, exerciseId: wheel.id, spec: { ...specOf(hlr) }, scope: 'program', bodyweight: true }, d);
    const swapped = after.plan.find((s) => s.slotId === hlr.slotId)!;
    expect([swapped.exerciseName, swapped.sets, swapped.fullSets]).toEqual(['Hanging Leg Raise', 2, 3]);
    expect((await getSessionLogs(session.id, d)).filter((l) => l.slotId === hlr.slotId)).toHaveLength(2);
    const progSlot = (await getActiveProgram(d))!.days[1].slots.find((s) => s.id === hlr.slotId)!;
    expect([progSlot.exerciseId, progSlot.sets, progSlot.introSets]).toEqual([wheel.id, 3, 2]);
    // changing the set count in the dialog drops the intro count
    const again = await swapExercise({ sessionId: session.id, slotId: hlr.slotId, exerciseId: wheel.id, spec: { ...specOf(hlr), sets: 4 }, scope: 'program' }, d);
    expect([again.plan.find((s) => s.slotId === hlr.slotId)!.sets, again.plan.find((s) => s.slotId === hlr.slotId)!.fullSets]).toEqual([4, undefined]);
    expect((await getActiveProgram(d))!.days[1].slots.find((s) => s.id === hlr.slotId)!.introSets).toBeUndefined();
  });
});

describe('order labels', () => {
  it('number exercises by position and letter the members of a superset', async () => {
    const { orderLabels } = await import('../state/plan');
    const p = await loadTemplate(THREE_DAY, d);
    expect(orderLabels(p.days[0].slots)).toEqual(['1', '2', '3', '4', '5A', '5B', '6']);
    expect(orderLabels(p.days[1].slots)).toEqual(['1', '2', '3', '4A', '4B', '5A', '5B', '6']);
    expect(orderLabels(p.days[2].slots)).toEqual(['1', '2', '3', '4A', '4B', '5A', '5B', '6A', '6B']);
    expect(orderLabels([{ supersetWithPrev: true }, {}, { supersetWithPrev: true }, { supersetWithPrev: true }])).toEqual(['1', '2A', '2B', '2C']);
    expect(orderLabels([])).toEqual([]);
  });
});
