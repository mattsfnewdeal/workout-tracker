import { DEFAULT_TARGET_RPE } from '../engine';
import type { Program, Slot } from '../model/types';
import { db, type WorkoutDB } from './db';
import { DEFAULT_INCREMENT, createProgram, emptyProgram, findOrCreateExercise, newDay, newSlot, newWarmup, updateExercise } from './ops';

export interface TemplateSlot {
  name: string;
  sets: number;
  /** A number is a fixed target (single progression); a pair is a rep range (double progression). */
  reps: number | [number, number];
  targetRpe?: number;
  increment?: number;
  /** Load is added weight; 0 / empty means bodyweight. */
  bodyweight?: boolean;
}
export interface TemplateDay {
  name: string;
  warmups: { name: string; note?: string }[];
  slots: TemplateSlot[];
}
export interface ProgramTemplate {
  name: string;
  days: TemplateDay[];
}

const COMMON_WARMUP = [{ name: '90/90 hips' }, { name: 'Open books' }, { name: 'Jump', note: '3 × 5' }];

/** Matt's Tuesday / Thursday program (2026-11-03). Loads are picked in each exercise's first session. */
export const PRELOADED: ProgramTemplate = {
  name: 'Tuesday / Thursday',
  days: [
    {
      name: 'Tuesday',
      warmups: [...COMMON_WARMUP, { name: 'Underhand Scoop', note: '3 × 4 with 4–6 kg' }],
      slots: [
        { name: 'Squat', sets: 3, reps: [4, 6] },
        { name: 'DB Bench', sets: 3, reps: [6, 8] },
        { name: 'DB SLDL', sets: 3, reps: 10 },
        { name: 'Chin', sets: 3, reps: [6, 10], bodyweight: true },
        { name: 'Pallof Press', sets: 3, reps: 10 },
        { name: 'DB Incline Curl', sets: 2, reps: [12, 15] },
      ],
    },
    {
      name: 'Thursday',
      warmups: [...COMMON_WARMUP, { name: 'Step-through Put', note: '3 × 4 with 4–6 kg' }],
      slots: [
        { name: 'Trap', sets: 3, reps: [4, 6] },
        { name: 'DB Press', sets: 3, reps: [8, 10] },
        { name: 'BSS', sets: 3, reps: 8 },
        { name: 'DB Row', sets: 3, reps: 10 },
        { name: 'Cable chop', sets: 3, reps: 10 },
        { name: 'DB OTE', sets: 2, reps: [12, 15] },
      ],
    },
  ],
};

/** Build a program from a template (reusing exercises by name) and make it the active one. */
export async function loadTemplate(t: ProgramTemplate, d: WorkoutDB = db): Promise<Program> {
  const program = emptyProgram(t.name);
  program.days = [];
  for (const td of t.days) {
    const day = newDay(td.name);
    day.warmups = td.warmups.map((w) => newWarmup(w.name, w.note));
    for (const ts of td.slots) {
      const ex = await findOrCreateExercise(ts.name, ts.increment ?? DEFAULT_INCREMENT, d);
      if (ts.bodyweight && !ex.bodyweight) await updateExercise(ex.id, { bodyweight: true }, d);
      const shape: Partial<Slot> = Array.isArray(ts.reps)
        ? { progression: 'double', repMin: ts.reps[0], repMax: ts.reps[1] }
        : { progression: 'single', targetReps: ts.reps };
      day.slots.push(newSlot(ex.id, { sets: ts.sets, targetRpe: ts.targetRpe ?? DEFAULT_TARGET_RPE, ...shape }));
    }
    program.days.push(day);
  }
  await createProgram(program, d);
  return program;
}
