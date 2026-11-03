import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkoutDB } from './db';
import {
  abandonSession, checkFinish, createProgram, emptyProgram, findOrCreateExercise, finishSession,
  newSlot, saveProgram, startSession, updateSetLog, validateProgram,
} from './ops';
import { getActiveProgram, getArchivedPrograms, getExerciseHistory, getInProgressSession, getLastCompletedSets, getSessionLogs } from './queries';
import { buildBackup, importBackup, parseBackup } from './backup';
import { buildPlan } from '../state/plan';
import type { Program } from '../model/types';

let d: WorkoutDB;
let squatId: string;
let benchId: string;
let program: Program;

/** Day A: Squat 3×5 @8, Bench 3×5 @8. Day B: Squat 3×6–8 @8 (shared exercise). No starting loads. */
async function setup() {
  d = new WorkoutDB(`test-${Math.random().toString(36).slice(2)}`);
  const squat = await findOrCreateExercise('Squat', 5, d);
  const bench = await findOrCreateExercise('Bench Press', 5, d);
  squatId = squat.id;
  benchId = bench.id;
  program = emptyProgram('Block 1');
  program.days[0].slots.push(newSlot(squatId, { sets: 3, progression: 'single', targetReps: 5 }));
  program.days[0].slots.push(newSlot(benchId, { sets: 3, progression: 'single', targetReps: 5 }));
  program.days[1].slots.push(newSlot(squatId, { sets: 3, progression: 'double', repMin: 6, repMax: 8 }));
  await createProgram(program, d);
}

/** Start the program's next day, log the given (load, reps, rpe) per set per slot, finish. */
async function runSession(sets: Record<string, [number, number, number | null][]>) {
  const prog = (await getActiveProgram(d))!;
  const plan = await buildPlan(prog, prog.nextDayIndex, d);
  const session = await startSession(prog, prog.nextDayIndex, plan, d);
  const logs = await getSessionLogs(session.id, d);
  for (const [exerciseId, rows] of Object.entries(sets)) {
    for (const [i, [load, reps, rpe]] of rows.entries()) {
      const log = logs.find((l) => l.exerciseId === exerciseId && l.setNumber === i + 1)!;
      await updateSetLog(log.id, { load, reps, rpe: rpe ?? undefined }, d);
    }
  }
  await finishSession(session.id, d);
  return session;
}

beforeEach(setup);

describe('program lifecycle', () => {
  it('creating a program archives the active one; archived ones are kept', async () => {
    const second = emptyProgram('Block 2');
    await createProgram(second, d);
    expect((await getActiveProgram(d))!.id).toBe(second.id);
    const archived = await getArchivedPrograms(d);
    expect(archived.map((p) => p.id)).toEqual([program.id]);
    expect(archived[0].archivedAt).toBeTypeOf('number');
  });

  it('refuses a new program while a session is in progress', async () => {
    const plan = await buildPlan(program, 0, d);
    await startSession(program, 0, plan, d);
    await expect(createProgram(emptyProgram('Block 2'), d)).rejects.toThrow(/finish or abandon/i);
  });

  it('rejects the same exercise twice in one day', () => {
    const p = emptyProgram('Bad');
    p.days[0].slots.push(newSlot(squatId), newSlot(squatId));
    expect(() => validateProgram(p)).toThrow(/twice/);
  });

  it('reuses an exercise by case-insensitive name', async () => {
    const again = await findOrCreateExercise('  squat ', 2.5, d);
    expect(again.id).toBe(squatId);
    expect(again.loadIncrement).toBe(5);
  });

  it('saveProgram clamps the pointer when days are removed', async () => {
    const prog = (await getActiveProgram(d))!;
    await saveProgram({ ...prog, nextDayIndex: 1, days: [prog.days[0]] }, d);
    expect((await getActiveProgram(d))!.nextDayIndex).toBe(0);
  });
});

describe('first session', () => {
  it('first session has no suggested load and pre-creates one empty row per set', async () => {
    const plan = await buildPlan(program, 0, d);
    expect(plan.map((p) => [p.exerciseName, p.suggestion.load, p.suggestion.reason])).toEqual([
      ['Squat', null, 'first-session'],
      ['Bench Press', null, 'first-session'],
    ]);
    const session = await startSession(program, 0, plan, d);
    const logs = await getSessionLogs(session.id, d);
    expect(logs).toHaveLength(6);
    expect(logs.every((l) => l.reps == null && l.load == null && l.suggestedLoad == null)).toBe(true);
    expect(logs.every((l) => !('load' in l) && !('suggestedLoad' in l))).toBe(true); // keys absent, never null
    expect((await getInProgressSession(d))!.id).toBe(session.id);
  });
});

describe('finish / abandon / pointer', () => {
  it('finishing advances the pointer and drops unlogged rows; abandoning does neither', async () => {
    await runSession({ [squatId]: [[225, 5, 7], [225, 5, null], [225, 5, null]] }); // bench skipped
    let prog = (await getActiveProgram(d))!;
    expect(prog.nextDayIndex).toBe(1);
    expect((await buildPlan(prog, 0, d))[1].suggestion).toMatchObject({ load: null, reason: 'first-session' }); // skipped slot stays a first session
    expect(await d.setLogs.count()).toBe(3);
    expect(await getInProgressSession(d)).toBeNull();

    const plan = await buildPlan(prog, 1, d);
    const s = await startSession(prog, 1, plan, d);
    const logs = await getSessionLogs(s.id, d);
    await updateSetLog(logs[0].id, { reps: 8, rpe: 8 }, d);
    await abandonSession(s.id, d);
    prog = (await getActiveProgram(d))!;
    expect(prog.nextDayIndex).toBe(1);
    expect(await d.setLogs.count()).toBe(3);
    expect(await getInProgressSession(d)).toBeNull();
  });

  it('wraps the pointer back to day A', async () => {
    await runSession({ [squatId]: [[225, 5, 7], [225, 5, null], [225, 5, null]] });
    await runSession({ [squatId]: [[185, 8, 8], [185, 8, null], [185, 7, null]] });
    expect((await getActiveProgram(d))!.nextDayIndex).toBe(0);
  });

  it('blocks finishing a partially logged slot or a set 1 without RPE', async () => {
    const plan = await buildPlan(program, 0, d);
    const session = await startSession(program, 0, plan, d);
    const logs = await getSessionLogs(session.id, d);
    const squatRows = logs.filter((l) => l.exerciseId === squatId);
    await updateSetLog(squatRows[0].id, { load: 225, reps: 5 }, d); // no rpe
    await updateSetLog(squatRows[1].id, { load: 225, reps: 5 }, d);
    const check = checkFinish(session, await getSessionLogs(session.id, d));
    expect(check.problems).toEqual(['Squat: 2 of 3 sets logged', 'Squat: set 1 needs an RPE']);
    expect(check.skipped).toEqual(['Bench Press']);
    await expect(finishSession(session.id, d)).rejects.toThrow(/2 of 3/);
  });

  it('blocks finishing a first-session set that has reps but no load', async () => {
    const plan = await buildPlan(program, 0, d);
    const session = await startSession(program, 0, plan, d);
    const logs = await getSessionLogs(session.id, d);
    for (const l of logs.filter((x) => x.exerciseId === squatId)) await updateSetLog(l.id, { reps: 5, rpe: l.setNumber === 1 ? 8 : undefined }, d);
    const check = checkFinish(session, await getSessionLogs(session.id, d));
    expect(check.problems).toEqual(['Squat set 1: enter the load', 'Squat set 2: enter the load', 'Squat set 3: enter the load']);
    await expect(finishSession(session.id, d)).rejects.toThrow(/enter the load/);
  });

  it('a session in progress survives: edits are persisted row by row', async () => {
    const plan = await buildPlan(program, 0, d);
    const session = await startSession(program, 0, plan, d);
    const logs = await getSessionLogs(session.id, d);
    await updateSetLog(logs[0].id, { load: 230, reps: 5, rpe: 7.5 }, d);
    const fresh = new WorkoutDB(d.name);
    const again = await getSessionLogs(session.id, fresh);
    const row = again.find((l) => l.id === logs[0].id)!;
    expect(row).toMatchObject({ load: 230, reps: 5, rpe: 7.5 });
  });
});

describe('progression across days and programs', () => {
  it('shared exercise updates from whichever day was logged last; in-progress is ignored', async () => {
    await runSession({ [squatId]: [[225, 5, 7], [225, 5, null], [225, 5, null]], [benchId]: [[135, 5, 8], [135, 5, null], [135, 5, null]] });
    let last = await getLastCompletedSets(squatId, d);
    expect(last!.sets.map((s) => [s.load, s.reps, s.rpe])).toEqual([[225, 5, 7], [225, 5, null], [225, 5, null]]);

    // Day B: squat 6–8 from day A's 5s → below-min → 225
    let prog = (await getActiveProgram(d))!;
    let planB = await buildPlan(prog, 1, d);
    expect(planB[0].suggestion).toMatchObject({ load: 225, reason: 'double-below-min' });
    expect(planB[0].lastSessionAt).toBeTypeOf('number');

    await runSession({ [squatId]: [[185, 9, 7], [185, 8, 8], [185, 7, 9]] });
    last = await getLastCompletedSets(squatId, d);
    expect(last!.sets[0]).toEqual({ setNumber: 1, load: 185, reps: 9, rpe: 7 });

    // Day A's 3×5 now builds from day B's set 1: e1 272.1 → 5@8 = 220.6 → 220
    prog = (await getActiveProgram(d))!;
    const planA = await buildPlan(prog, 0, d);
    expect(planA[0].suggestion).toMatchObject({ load: 220, reason: 'single-progress', bigJump: true });
    expect(planA[1].suggestion).toMatchObject({ load: 140, reason: 'single-progress' }); // bench 5@8 → floor → bump

    // An in-progress session doesn't change anything
    const s = await startSession(prog, 0, planA, d);
    const logs = await getSessionLogs(s.id, d);
    expect(logs.find((l) => l.exerciseId === squatId && l.setNumber === 1)).toMatchObject({ load: 220, suggestedLoad: 220 }); // prefilled once there is a suggestion
    await updateSetLog(logs[0].id, { load: 300, reps: 5, rpe: 6.5 }, d);
    last = await getLastCompletedSets(squatId, d);
    expect(last!.sets[0].load).toBe(185);
  });

  it('a new program reusing an exercise continues from the old program’s history', async () => {
    await runSession({ [squatId]: [[225, 5, 7], [225, 5, null], [225, 5, null]] });
    const next = emptyProgram('Block 2');
    next.days[0].slots.push(newSlot(squatId, { sets: 3, progression: 'single', targetReps: 5 }));
    await createProgram(next, d);
    const plan = await buildPlan((await getActiveProgram(d))!, 0, d);
    expect(plan[0].suggestion).toMatchObject({ load: 230, reason: 'single-progress' });
    const history = await getExerciseHistory(squatId, d);
    expect(history).toHaveLength(1);
    expect(history[0].e1rm).toBeCloseTo(286.3, 1);
  });
});

describe('backup', () => {
  it('round-trips through export → reset → import', async () => {
    await runSession({ [squatId]: [[225, 5, 7], [225, 5, null], [225, 5, null]] });
    const backup = await buildBackup(d);
    const text = JSON.stringify(backup);
    const other = new WorkoutDB(`test-${Math.random().toString(36).slice(2)}`);
    await importBackup(parseBackup(text), other);
    expect(await other.setLogs.count()).toBe(3);
    expect((await getActiveProgram(other))!.id).toBe(program.id);
    expect((await other.meta.get('lastBackupAt'))!.value).toBe(Date.parse(backup.exportedAt));
    expect((await buildPlan((await getActiveProgram(other))!, 0, other))[0].suggestion.load).toBe(230);
  });

  it('rejects files that aren’t backups', () => {
    expect(() => parseBackup('nope')).toThrow(/valid JSON/);
    expect(() => parseBackup('{"app":"other"}')).toThrow(/isn.t a Workout Tracker backup/);
    expect(() => parseBackup('{"app":"workout-tracker","schemaVersion":99,"exercises":[]}')).toThrow(/newer/);
    expect(() => parseBackup('{"app":"workout-tracker","schemaVersion":1,"exercises":[]}')).toThrow(/missing "programs"/);
  });
});

describe('first-session rows', () => {
  it('a typed 0 is not a load', async () => {
    const plan = await buildPlan(program, 0, d);
    const session = await startSession(program, 0, plan, d);
    const rows = (await getSessionLogs(session.id, d)).filter((l) => l.exerciseId === squatId).sort((a, b) => a.setNumber - b.setNumber);
    await updateSetLog(rows[0].id, { load: 0, reps: 5, rpe: 8 }, d);
    await updateSetLog(rows[1].id, { load: 225, reps: 5 }, d);
    await updateSetLog(rows[2].id, { load: 225, reps: 5 }, d);
    expect(checkFinish(session, await getSessionLogs(session.id, d)).problems).toEqual(['Squat set 1: load must be above 0']);
  });

  it('an abandoned first session is a first session again', async () => {
    const plan = await buildPlan(program, 0, d);
    const session = await startSession(program, 0, plan, d);
    for (const l of (await getSessionLogs(session.id, d)).filter((x) => x.exerciseId === squatId)) await updateSetLog(l.id, { load: 225, reps: 5, rpe: 7 }, d);
    await abandonSession(session.id, d);
    expect(await d.setLogs.count()).toBe(0);
    expect((await buildPlan(program, 0, d))[0].suggestion).toMatchObject({ load: null, reason: 'first-session' });
  });

  it('clearing a load removes the key on disk', async () => {
    const plan = await buildPlan(program, 0, d);
    const session = await startSession(program, 0, plan, d);
    const row = (await getSessionLogs(session.id, d))[0];
    await updateSetLog(row.id, { load: 225 }, d);
    expect((await d.setLogs.get(row.id))!.load).toBe(225);
    await updateSetLog(row.id, { load: undefined }, d);
    const fresh = new WorkoutDB(d.name);
    const again = (await fresh.setLogs.get(row.id))!;
    expect('load' in again).toBe(false);
  });

  it('a completed row without a load is ignored, not coerced to 0', async () => {
    await runSession({ [squatId]: [[225, 5, 7], [225, 5, null], [225, 5, null]] });
    const set1 = (await d.setLogs.where('exerciseId').equals(squatId).toArray()).find((l) => l.setNumber === 1)!;
    await d.setLogs.update(set1.id, { load: undefined });
    const last = await getLastCompletedSets(squatId, d);
    expect(last!.sets.map((s) => s.setNumber)).toEqual([2, 3]);
    expect((await buildPlan((await getActiveProgram(d))!, 0, d))[0].suggestion).toMatchObject({ load: null, reason: 'first-session' });
    const history = await getExerciseHistory(squatId, d);
    expect(history[0].sets).toHaveLength(2);
    expect(history[0].e1rm).toBeNull();
  });
});

describe('range slot from scratch', () => {
  it('empty first session, then the spec example 185×9@7 → 215, then hold with beat 7', async () => {
    const benchOnly = emptyProgram('Bench only');
    benchOnly.days = [benchOnly.days[0]];
    benchOnly.days[0].slots.push(newSlot(benchId, { sets: 3, progression: 'double', repMin: 6, repMax: 8 }));
    await createProgram(benchOnly, d);
    let plan = await buildPlan(benchOnly, 0, d);
    expect(plan[0].suggestion).toMatchObject({ load: null, reason: 'first-session', repTarget: { kind: 'range', min: 6, max: 8, beat: null } });
    const session = await startSession(benchOnly, 0, plan, d);
    expect((await getSessionLogs(session.id, d)).every((l) => !('load' in l))).toBe(true);
    await abandonSession(session.id, d);

    await runSession({ [benchId]: [[185, 9, 7], [185, 8, 8], [185, 7, 9]] });
    plan = await buildPlan((await getActiveProgram(d))!, 0, d);
    expect(plan[0].suggestion).toMatchObject({ load: 215, reason: 'double-progress', bigJump: true, confidence: 'normal' });
    expect(plan[0].suggestion.e1rm).toBeCloseTo(272.06, 1);
    const history = await getExerciseHistory(benchId, d);
    expect(history).toHaveLength(1);
    expect(history[0].e1rm).toBeCloseTo(272.06, 1);
    expect(history[0].sets.map((s) => [s.load, s.reps, s.rpe])).toEqual([[185, 9, 7], [185, 8, 8], [185, 7, 9]]);

    await runSession({ [benchId]: [[215, 7, 8], [215, 7, null], [215, 6, null]] });
    plan = await buildPlan((await getActiveProgram(d))!, 0, d);
    expect(plan[0].suggestion).toMatchObject({ load: 215, reason: 'double-hold-add-reps', repTarget: { kind: 'range', min: 6, max: 8, beat: 7 } });
  });
});

describe('program validation', () => {
  it('a range needs max above min', () => {
    for (const [repMin, repMax] of [[6, 6], [8, 6]]) {
      const p = emptyProgram('Bad');
      p.days[0].slots.push(newSlot(squatId, { progression: 'double', repMin, repMax }));
      expect(() => validateProgram(p)).toThrow(/rep range must be like/);
    }
    const ok = emptyProgram('Ok');
    ok.days[0].slots.push(newSlot(squatId, { progression: 'double', repMin: 6, repMax: 8 }));
    expect(() => validateProgram(ok)).not.toThrow();
  });
});

describe('backup compat', () => {
  it('imports a v1 backup whose slots carry startingLoad and drops the key', async () => {
    await runSession({ [squatId]: [[225, 5, 7], [225, 5, null], [225, 5, null]] });
    const raw = JSON.parse(JSON.stringify(await buildBackup(d)));
    for (const p of raw.programs) for (const day of p.days) for (const s of day.slots) s.startingLoad = 999;
    const other = new WorkoutDB(`test-${Math.random().toString(36).slice(2)}`);
    await importBackup(parseBackup(JSON.stringify(raw)), other);
    const active = (await getActiveProgram(other))!;
    expect(active.days.flatMap((day) => day.slots).some((s) => 'startingLoad' in s)).toBe(false);
    const plan = await buildPlan(active, 0, other);
    expect(plan[0].suggestion.load).toBe(230);
    expect(plan[1].suggestion).toMatchObject({ load: null, reason: 'first-session' });
  });
});
