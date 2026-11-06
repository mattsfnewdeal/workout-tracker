import { DEFAULT_TARGET_RPE } from '../engine';
import type { Program, Slot } from '../model/types';
import { db, type WorkoutDB } from './db';
import { DEFAULT_INCREMENT, createProgram, emptyProgram, findOrCreateExercise, newDay, newSlot, newWarmup, updateExercise } from './ops';

export interface TemplateSlot {
  name: string;
  sets: number;
  /** A number is a fixed target (single progression); a pair is a rep range (double progression). */
  reps: number | [number, number];
  /** null = no RPE goal (linear main lifts). Default 8. */
  targetRpe?: number | null;
  increment?: number;
  /** Load is added weight; 0 / empty means bodyweight. */
  bodyweight?: boolean;
  /** 'linear': add the increment when every set hits its target. Default: from RPE / e1RM. */
  rule?: 'linear';
  /** Sets during the program's intro weeks. */
  introSets?: number;
  /** Superset with the slot above (A2 of an A1/A2 pair). */
  superset?: boolean;
}
export interface TemplateDay {
  name: string;
  warmups: { name: string; note?: string }[];
  slots: TemplateSlot[];
}
export interface ProgramTemplate {
  name: string;
  /** One line for the New program dialog. */
  blurb: string;
  introWeeks?: number;
  days: TemplateDay[];
}

const COMMON_WARMUP = [{ name: '90/90 hips' }, { name: 'Open books' }, { name: 'Jump', note: '3 × 5' }];

/** Matt's Tuesday / Thursday program (2026-11-03). Loads are picked in each exercise's first session. */
export const PRELOADED: ProgramTemplate = {
  name: 'Tuesday / Thursday',
  blurb: 'Two days, BBM-style: rep ranges at an RPE goal, loads from e1RM.',
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

const LIN = { rule: 'linear' as const };
const MAIN = { ...LIN, targetRpe: null };

/**
 * Matt's 3×/week full-body program (2026-11-06). Main lifts run linear progression (add the increment
 * when every set is completed; hold on a miss; drop 10% after two misses); accessories are rep ranges
 * at ~2 reps in reserve, adding the increment once every set reaches the top of the range. Weeks 1–2
 * use the reduced set counts (`introSets`). A1/A2 pairs are supersets. "Hanging Leg Raise or Ab Wheel"
 * is Ab Wheel (Matt's choice). "(1-2)" intro counts are taken as 1. Day 1's and Day 3's lateral raises are
 * the same exercise.
 */
export const THREE_DAY: ProgramTemplate = {
  name: '3x Lifting',
  blurb: 'Three full-body days: linear main lifts, double-progression accessories, supersets, two intro weeks.',
  introWeeks: 2,
  days: [
    {
      name: 'Day 1',
      warmups: [],
      slots: [
        { name: 'Back Squat', sets: 3, reps: 5, ...MAIN, increment: 5 },
        { name: 'Bench Press', sets: 3, reps: 5, ...MAIN, increment: 5 },
        { name: 'Chest-Supported Row', sets: 4, reps: [8, 12], ...LIN, introSets: 2 },
        { name: 'Romanian Deadlift', sets: 3, reps: [8, 12], ...LIN, introSets: 2 },
        { name: 'Lateral Raise', sets: 3, reps: [12, 20], ...LIN, introSets: 2 },
        { name: 'Face Pull', sets: 2, reps: [12, 20], ...LIN, introSets: 2, superset: true },
        { name: 'Calf Raise', sets: 3, reps: [10, 15], ...LIN, introSets: 2 },
      ],
    },
    {
      name: 'Day 2',
      warmups: [],
      slots: [
        { name: 'Deadlift', sets: 2, reps: 5, ...MAIN, increment: 10 },
        { name: 'Overhead Press', sets: 3, reps: 5, ...MAIN, increment: 2.5 },
        { name: 'Bulgarian Split Squat', sets: 3, reps: [8, 12], ...LIN, introSets: 2 },
        { name: 'Lat Pulldown', sets: 4, reps: [8, 12], ...LIN, introSets: 2 },
        { name: 'Incline DB Press', sets: 3, reps: [8, 12], ...LIN, introSets: 2, superset: true },
        { name: 'Curl', sets: 3, reps: [10, 15], ...LIN, introSets: 2 },
        { name: 'Calf Raise', sets: 3, reps: [10, 15], ...LIN, introSets: 2, superset: true },
        { name: 'Ab Wheel', sets: 3, reps: [8, 15], ...LIN, introSets: 2, bodyweight: true },
      ],
    },
    {
      name: 'Day 3',
      warmups: [],
      slots: [
        { name: 'Back Squat', sets: 3, reps: 5, ...MAIN, increment: 5 },
        { name: 'Bench Press', sets: 3, reps: 5, ...MAIN, increment: 5 },
        { name: 'DB Reverse Lunge', sets: 2, reps: [8, 12], ...LIN, introSets: 1 },
        { name: 'Cable Row', sets: 3, reps: [8, 12], ...LIN, introSets: 2 },
        { name: 'Leg Curl', sets: 3, reps: [10, 15], ...LIN, introSets: 2, superset: true },
        { name: 'Overhead Extension', sets: 3, reps: [10, 15], ...LIN, introSets: 2 },
        { name: 'Hammer Curl', sets: 2, reps: [10, 15], ...LIN, introSets: 1, superset: true },
        { name: 'Lateral Raise', sets: 3, reps: [12, 20], ...LIN, introSets: 2 },
        { name: 'Face Pull', sets: 2, reps: [12, 20], ...LIN, introSets: 2, superset: true },
      ],
    },
  ],
};

export const TEMPLATES: ProgramTemplate[] = [THREE_DAY, PRELOADED];

/** Build a program from a template (reusing exercises by name) and make it the active one. */
export async function loadTemplate(t: ProgramTemplate, d: WorkoutDB = db): Promise<Program> {
  const program = emptyProgram(t.name);
  program.days = [];
  if (t.introWeeks) program.introWeeks = t.introWeeks;
  for (const td of t.days) {
    const day = newDay(td.name);
    day.warmups = td.warmups.map((w) => newWarmup(w.name, w.note));
    for (const ts of td.slots) {
      const ex = await findOrCreateExercise(ts.name, ts.increment ?? DEFAULT_INCREMENT, d);
      if (ts.bodyweight && !ex.bodyweight) await updateExercise(ex.id, { bodyweight: true }, d);
      const shape: Partial<Slot> = Array.isArray(ts.reps)
        ? { progression: 'double', repMin: ts.reps[0], repMax: ts.reps[1] }
        : { progression: 'single', targetReps: ts.reps };
      day.slots.push(newSlot(ex.id, {
        sets: ts.sets,
        targetRpe: ts.targetRpe === null ? undefined : ts.targetRpe ?? DEFAULT_TARGET_RPE,
        ...shape,
        ...(ts.rule ? { rule: ts.rule } : {}),
        ...(ts.introSets != null ? { introSets: ts.introSets } : {}),
        ...(ts.superset ? { supersetWithPrev: true } : {}),
      }));
    }
    program.days.push(day);
  }
  await createProgram(program, d);
  return program;
}
