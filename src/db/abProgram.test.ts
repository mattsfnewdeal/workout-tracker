import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkoutDB } from './db';
import { createProgram, deleteProgram, emptyProgram, finishSession, startSession, updateSetLog, validateProgram } from './ops';
import { getActiveProgram, getArchivedPrograms, getExerciseHistory, getSessionLogs } from './queries';
import { buildPlan, orderLabels, supersetGroups } from '../state/plan';
import { AB, TEMPLATES, loadTemplate } from './templates';

let d: WorkoutDB;
beforeEach(() => {
  d = new WorkoutDB(`test-${Math.random().toString(36).slice(2)}`);
});

describe('Day A / Day B template', () => {
  it('is the only preloaded program and loads as written', async () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(['Day A / Day B']);
    const p = await loadTemplate(AB, d);
    expect(() => validateProgram(p)).not.toThrow();
    expect(p.days.map((x) => x.name)).toEqual(['Day A (Tue)', 'Day B (Thu/Fri)']);
    expect(p.days[0].warmups!.map((w) => [w.name, w.note])).toEqual([['Seated box jump', '3 × 3']]);
    expect(p.days[1].warmups![0].name).toBe('Weighted box jump');
    expect(orderLabels(p.days[0].slots)).toEqual(['1', '2', '3', '4', '5']);
    expect(orderLabels(p.days[1].slots)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(p.days.flatMap((x) => x.slots).some((s) => s.supersetWithPrev)).toBe(false);
    const ex = await d.exercises.toArray();
    const by = (n: string) => ex.find((e) => e.name === n)!;
    expect([by('Trap Bar Deadlift').loadIncrement, by('Bench Press').loadIncrement, by('RDL').loadIncrement, by('Chest-Supported Row').loadIncrement]).toEqual([10, 5, 10, 5]);
    expect(ex.map((e) => e.name)).not.toContain('Seated DB Press');
    expect(ex.map((e) => e.name)).not.toContain('Incline Barbell Bench');
    expect([by('Weighted Chin-up').bodyweight, by('Ab Wheel').bodyweight, by('Suitcase Carry').bodyweight]).toEqual([true, true, undefined]);
    const a = p.days[0].slots;
    expect(a.map((s) => [s.rule, s.targetRpe ?? null])).toEqual([['linear', null], ['linear', null], ['linear', 8], ['linear', 8], ['linear', null]]);
    const b = p.days[1].slots;
    expect(b.map((s) => s.rule)).toEqual(['linear', 'linear', 'linear', 'linear', 'manual', 'manual']);
    expect(b[2].targetRpe).toBe(7); // RDL at RPE 7
    expect(b[5]).toMatchObject({ progression: 'double', repMin: 30, repMax: 40 });
    expect(b[4].note).toMatch(/lower back stays flat/);
    expect(p.introWeeks).toBeUndefined();
  });

  it('accessories move up only at the top of the range at RPE 8 or easier; manual slots hold; notes reach the plan', async () => {
    await loadTemplate(AB, d);
    const run = async (dayIndex: number, log: Record<string, [number, number, number | null][]>) => {
      const prog = (await getActiveProgram(d))!;
      const plan = await buildPlan(prog, dayIndex, d);
      const session = await startSession(prog, dayIndex, plan, d);
      const logs = await getSessionLogs(session.id, d);
      for (const slot of plan) {
        const rows = log[slot.exerciseName];
        if (!rows) continue;
        for (const l of logs.filter((x) => x.slotId === slot.slotId)) {
          const [load, reps, rpe] = rows[l.setNumber - 1];
          await updateSetLog(l.id, { load, reps, rpe: rpe ?? undefined }, d);
        }
      }
      await finishSession(session.id, d);
    };
    await run(1, {
      'RDL': [[185, 8, 7.5], [185, 8, null], [185, 8, null]], // top of range but over RPE 7
      'Chest-Supported Row': [[100, 12, 8], [100, 12, null], [100, 12, null]],
      'Ab Wheel': [[0, 10, 8], [0, 10, null], [0, 10, null]],
      'Suitcase Carry': [[75, 40, 7], [75, 35, null]],
    });
    const next = await buildPlan((await getActiveProgram(d))!, 1, d);
    const by = (n: string) => next.find((s) => s.exerciseName === n)!;
    expect(by('RDL').suggestion).toMatchObject({ load: 185, reason: 'linear-hold-rpe' });
    expect(by('Chest-Supported Row').suggestion).toMatchObject({ load: 105, reason: 'linear-progress' });
    expect(by('Ab Wheel').suggestion).toMatchObject({ load: 0, reason: 'manual-hold' });
    expect(by('Ab Wheel').warmupSets).toEqual([{ load: 0, reps: 5, done: false }]);
    expect(by('Suitcase Carry').suggestion).toMatchObject({ load: 75, reason: 'manual-hold', repTarget: { kind: 'range', min: 30, max: 40 } });
    expect(by('Suitcase Carry').warmupSets).toEqual([]); // 40-rep "sets": the ramp caps reps, but a 75 lb main-class lift under 95 gets none
    expect(by('Suitcase Carry').note).toMatch(/metres per side/);
    expect(supersetGroups(next).every((g) => g.length === 1)).toBe(true);
  });

  it('archived programs can be deleted; the active one cannot; history stays', async () => {
    const first = emptyProgram('Old');
    await createProgram(first, d);
    const p = await loadTemplate(AB, d);
    expect((await getArchivedPrograms(d)).map((x) => x.id)).toEqual([first.id]);
    await expect(deleteProgram(p.id, d)).rejects.toThrow(/can’t be deleted/);
    await deleteProgram(first.id, d);
    expect(await getArchivedPrograms(d)).toEqual([]);
    expect((await getActiveProgram(d))!.id).toBe(p.id);
    await deleteProgram('nope', d); // no-op
    // a session logged under the deleted program still shows in History
    const bench = p.days[0].slots[1].exerciseId;
    const plan = await buildPlan(p, 0, d);
    const session = await startSession(p, 0, plan, d);
    for (const l of (await getSessionLogs(session.id, d)).filter((x) => x.exerciseId === bench)) await updateSetLog(l.id, { load: 135, reps: 5, rpe: l.setNumber === 1 ? 8 : undefined }, d);
    await finishSession(session.id, d);
    await createProgram(emptyProgram('Next'), d);
    await deleteProgram(p.id, d);
    expect((await getExerciseHistory(bench, d))).toHaveLength(1);
  });
});
