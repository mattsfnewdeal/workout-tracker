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
  /** 'linear': add the increment when every set hits its target; 'manual': hold, progress by feel. Default: from RPE / e1RM. */
  rule?: 'linear' | 'manual';
  /** Sets during the program's intro weeks. */
  introSets?: number;
  /** Superset with the slot above (A2 of an A1/A2 pair). */
  superset?: boolean;
  /** Coaching note shown on the card. */
  note?: string;
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

const LIN = { rule: 'linear' as const };
const MAIN = { ...LIN, targetRpe: null };
const MANUAL = { rule: 'manual' as const, targetRpe: null };

/**
 * Matt's Day A / Day B program (2026-11-06; Seated DB Press and Incline Bench dropped the same evening). Box jumps are the day's checkbox warm-up. Main lifts run linear
 * progression with the program's weekly jumps; accessories are rep ranges that add the jump once every set hits
 * the top of the range at RPE 8 or easier (RDL at RPE 7). Ab wheel and the suitcase carry progress by feel
 * ('manual'), with the program's instructions as the slot note. The carry logs metres per side in the reps field.
 */
export const AB: ProgramTemplate = {
  name: 'Day A / Day B',
  blurb: 'Two days: linear main lifts, double-progression accessories at RPE 8, jumps, ab wheel and carries.',
  days: [
    {
      name: 'Day A (Tue)',
      warmups: [{ name: 'Seated box jump', note: '3 × 3' }],
      slots: [
        { name: 'Trap Bar Deadlift', sets: 3, reps: 5, ...MAIN, increment: 10, note: 'Linear: +10 lb a week when every rep is there. Start about 10% under what you could do today.' },
        { name: 'Bench Press', sets: 4, reps: 5, ...MAIN, increment: 5, note: 'Linear: +5 lb a week when every rep is there. Start about 10% under.' },
        { name: 'FFE Split Squat', sets: 3, reps: [8, 10], ...LIN, note: 'Per leg, front foot elevated. Top of the range at RPE 8 or easier → +5 lb, back to 8.' },
        { name: 'Weighted Chin-up', sets: 3, reps: [3, 6], ...LIN, bodyweight: true, note: 'Load is added weight; leave empty for bodyweight. Top of the range at RPE 8 or easier → +5 lb, back to 3.' },
        { name: 'Pallof Press', sets: 2, reps: 10, ...MAIN, note: 'Per side.' },
      ],
    },
    {
      name: 'Day B (Thu/Fri)',
      warmups: [{ name: 'Weighted box jump', note: '3 × 3 · 10–20 lb total, stay fast, step down' }],
      slots: [
        { name: 'Barbell BSS', sets: 3, reps: 6, ...MAIN, increment: 5, note: 'Per leg. Squat to a box or pad for depth. Linear: +5 lb a week when every rep is there.' },
        { name: 'Standing DB Overhead Press', sets: 4, reps: 6, ...MAIN, increment: 5, note: 'Per hand. +5 lb per hand when all reps are clean. Stuck: add a rep per set (4 × 7, then 4 × 8) before adding weight.' },
        { name: 'RDL', sets: 3, reps: [6, 8], ...LIN, targetRpe: 7, increment: 10, note: 'Top of the range at RPE 7 or easier → +10 lb, back to 6.' },
        { name: 'Chest-Supported Row', sets: 3, reps: [8, 12], ...LIN, note: 'Top of the range at RPE 8 or easier → +5 lb, back to 8.' },
        { name: 'Ab Wheel', sets: 3, reps: [6, 10], ...MANUAL, bodyweight: true, note: 'Start on knees; only roll out as far as your lower back stays flat. At 3 × 10 full range, slow the way out to 3 s. Then roll toward a wall from standing.' },
        { name: 'Suitcase Carry', sets: 2, reps: [30, 40], ...MANUAL, note: 'Reps = metres per side (about 40–50 steps). Start at 70–80 lb. Build from 30 to 40 m, then add 5–10 lb and go back to 30 m. Stay upright, no leaning.' },
      ],
    },
  ],
};

export const TEMPLATES: ProgramTemplate[] = [AB];

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
        ...(ts.note ? { note: ts.note } : {}),
      }));
    }
    program.days.push(day);
  }
  await createProgram(program, d);
  return program;
}
