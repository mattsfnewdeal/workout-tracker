# Workout Tracker — Spec (v1.7)

A simple, personal lifting tracker. Runs as a PWA on iPhone (added to the home screen). One user, no backend, no accounts.

> **Repo location:** This is a personal project. Create the repo and GitHub Pages site under **Matt's personal GitHub account, not the SFND organization account.** Before the first push, check the git remote and the logged-in `gh` account, and confirm with Matt if either points at SFND.

## Goals

- Build a program from custom exercises with sets, rep targets, and a progression type.
- Log each set: load, reps achieved, RPE.
- Suggest next session's load automatically using RPE-based e1RM.
- Start with a 2x/week A/B program.

## Out of scope for v1

Rest timer, charts, deload automation, cloud sync, multi-device, exercise library, accounts.

---

## Stack (suggested)

- Vite + TypeScript + Preact (or plain TS if simpler)
- IndexedDB via Dexie for storage
- `vite-plugin-pwa` for manifest + service worker (fully offline)
- Hosted on GitHub Pages from Matt's **personal** GitHub account (not SFND's org)
- Vitest for unit tests on the progression engine

### iOS notes

- Must work when launched from the home screen (standalone display mode, proper icons, safe-area padding).
- Safari can clear web app storage. Include **Export JSON** and **Import JSON** in Settings from day one. Show "last backup" date on the settings screen.

---

## Units and rounding

- Everything in **pounds**.
- Each exercise has a **load increment** (e.g. 5 lb barbell, 5 lb dumbbell step, 2.5 lb if microplates). Suggested loads round to the nearest increment.
- If a progression is supposed to happen but rounding would erase it, bump up by one increment.
---

## Data model

```
Exercise
  id, name, loadIncrement (lb)

Program
  id, name, days: Day[]            // v1: Day A, Day B
  nextDayIndex                     // A/B alternation pointer

Day
  id, name, slots: Slot[]          // ordered

Slot
  id, exerciseId
  sets
  progression: "single" | "double"
  // single:
  targetReps
  // double:
  repMin, repMax
  startingLoad (lb)                // used until first log exists

Session
  id, programId, dayId, date, completed

SetLog
  id, sessionId, slotId, exerciseId, setNumber
  load (lb), reps, rpe             // rpe in 0.5 steps
```

Progression state is **per exercise**, not per slot. If an exercise appears on both A and B, every session updates it, and each slot uses its own rep targets to compute its suggestion from the most recent logged session of that exercise.

---

## RPE

Follows RTS / Barbell Medicine conventions: RPE = reps in reserve (RIR).

| RPE | Meaning |
|---|---|
| 10 | Max effort, no reps left |
| 9.5 | No reps left, could maybe add a little weight |
| 9 | 1 rep left |
| 8.5 | 1–2 reps left |
| 8 | 2 reps left |
| 7.5 | 2–3 reps left |
| 7 | 3 reps left |
| 6.5 | 3–4 reps left |

- Input: RPE 6.5 to 10 in half steps. Lower RPEs aren't rated reliably, so they aren't offered.
- **Working range is RPE 7–9.** (v1.3: completed sets are coloured relative to the slot's goal RPE instead — green when reps hit the target and RPE is within ±1 of the goal, which is 7–9 for the default goal 8; blue when RPE is more than a point under; amber when reps fall short or RPE is more than a point over.)
- **Target RPE for suggestions is 8.**

### RTS %1RM table

The table collapses to one lookup keyed by **effective reps = reps + RIR**, where RIR = 10 − RPE.

| Eff. reps | %1RM | Eff. reps | %1RM |
|---|---|---|---|
| 1 | 100.0 | 8.5 | 77.4 |
| 1.5 | 97.8 | 9 | 76.2 |
| 2 | 95.5 | 9.5 | 75.1 |
| 2.5 | 93.9 | 10 | 73.9 |
| 3 | 92.2 | 10.5 | 72.3 |
| 3.5 | 90.7 | 11 | 70.7 |
| 4 | 89.2 | 11.5 | 69.4 |
| 4.5 | 87.8 | 12 | 68.0 |
| 5 | 86.3 | 12.5 | 66.7 |
| 5.5 | 85.0 | 13 | 65.3 |
| 6 | 83.7 | 13.5 | 64.0 |
| 6.5 | 82.4 | 14 | 62.6 |
| 7 | 81.1 | 14.5 | 61.3 |
| 7.5 | 79.9 | 15 | 59.9 |
| 8 | 78.6 | 15.5 | 58.6 |

The table covers 1–12 reps at RPE 6.5–10. These values come from the RTS chart from memory, so double-check them against the published chart before shipping.

- `e1RM = load / pct(reps + RIR)`
- `suggestedLoad = e1RM × pct(targetReps + (10 − 8))`
- If a set has **more than 12 reps**, don't compute an e1RM from it. Use the fallback rules below and show "low confidence."

**Set 1 drives the e1RM and how big the next jump is.** Later sets don't change the jump size because fatigue makes them noisy. For single progression, though, every set must hit target reps before the load can go up (see below).

**The e1RM always uses what was actually logged** (load, reps, RPE), not what was suggested. If you load heavier than suggested or beat the rep target, the next suggestion builds from that.

---

## Progression rules

### Double progression (rep range, e.g. 6–8)

Look at set 1 of the most recent session for this exercise:

1. **Reps > repMax (went past the top) and RPE ≤ 9** → progress. The next load lands **repMin @ RPE 8**, calculated from that set's e1RM.
2. **Reps within the range and RPE ≤ 9** → keep the same load and aim for more reps.
3. **RPE > 9** → recalculate so the reps just done land at RPE 8. This usually means a small drop.
4. **Reps < repMin** → recalculate so repMin lands at RPE 8.

The suggested rep target shown is "repMin–repMax, beat last time's set 1."

**Example (range 6–8):** set 1 is 185 × 9 @ 7. That's 12 effective reps, so 68.0% and an e1RM of 272. The next load is 6 @ 8, which is 78.6% of 272, or 213.8. That rounds to **215**.

### Single progression (fixed reps, e.g. 3×5)

Look at the most recent session for this exercise:

1. **Every set reached at least targetReps, and set 1 was RPE ≤ 9** → the next load is targetReps @ RPE 8, calculated from set 1's e1RM, then rounded.
   - **Minimum +1%.** A solid RPE 8 would otherwise suggest the same load.
   - **No upper cap.** A low RPE or beating the target reps can suggest a bigger jump.
   - If the jump is over 10%, show a small "big jump" note on the suggestion so it's easy to sanity-check. Don't block it.
2. **Set 1 RPE > 9** → hold the load.
3. **Any set missed targetReps** (including when set 1 hit it) → hold the load until every set is clean.
4. The rep target never changes. Single progression only moves the load.

**Examples (last session 225 × 5):**

| Set 1 | e1RM | Raw next | After clamp + rounding |
|---|---|---|---|
| 5 @ 6.5 | 290.7 | 235.8 (+4.8%) | **235** |
| 5 @ 7 | 286.3 | 232.2 (+3.2%) | **230** |
| 5 @ 8 | 277.4 | 225 (0%) | +1% floor → 227.25, bumps to **230** |
| 7 @ 7 (beat target) | 304.5 | 246.9 (+9.7%) | **245** |
| 5 @ 9.5 | — | — | hold at **225** |
| 5 @ 7, then 5, 4 | — | — | later set missed → hold at **225** |

**Over-performing example:** the app suggests 230 × 5. You load 235 and get 7, 6, 6, with set 1 @ 7. That's 10 effective reps, so 73.9% and an e1RM of 318. The next load is 5 @ 8, which is 81.1% of 318, or 257.9. That rounds to **260 × 5** (+10.6%), and the "big jump" note shows.

The engine's tests should assert these exact numbers.

### Fallback (no usable e1RM)

This applies to the first session (use startingLoad) and to sets over 12 reps. Use simple rules:
- **Double:** went past repMax → add one increment.
- **Single:** hit target → add one increment.
- Otherwise hold.

### Override

The suggested load and reps are prefilled but always editable. Logged values are what feed the next calculation.

---

## Screens

1. **Today / Next workout**
   - Shows the next day in the A/B rotation.
   - Lists each slot with its suggested load and rep target, plus last session's set 1 for reference.
   - A **Start** button opens the log screen.
2. **Log session**
   - One row per set with load (prefilled), reps, and RPE.
   - Reps open the numeric keypad. RPE uses a picker or segmented control in half steps.
   - Big **Finish** button. Finishing saves the session and advances the A/B pointer.
   - Completed sets are colour-coded against the slot's rep target and RPE goal (see the Working range note above).
3. **Program editor**
   - Add, rename, or reorder days and slots. Add new exercises inline.
   - Each slot sets: sets, progression type, reps (target or range), starting load, and exercise increment.
4. **History**
   - Pick an exercise to see past sessions: date, all sets, and the e1RM from set 1.
5. **Settings**
   - Export/import JSON, last backup date, and a reset option.

## Behavior details

- The A/B pointer advances only when a session is finished, not by calendar day.
- A session can be abandoned without advancing the pointer.
- A session in progress survives the app being closed (save every input as it's entered).

---

## Testing

- Unit tests for the table lookup (including half steps).
- e1RM and suggestedLoad math.
- Every branch of double and single progression, using the examples above.
- Rounding edge cases: the bump when rounding would erase the jump, plus the +1% floor.
- The "big jump" note shows when the jump is over 10%.
- Single progression holds when set 1 hits target but a later set misses.
- Logged load overrides suggested load (the over-performing example).
- An exercise shared across days A and B updates from whichever day was logged last.

---

## v1.1 amendments (2026-11-03)

These supersede the matching v1 sections above.

1. **Start empty.** No seeded program. First launch shows a "No program yet — build one" prompt that opens the Program builder. A new program starts with two empty days ("Day A", "Day B") that can be renamed, added, removed, or reordered.
2. **Program lifecycle.** A program is a one-week microcycle (N days; the pointer cycles through them) that repeats indefinitely with progression applied on every pass, **until it is archived by creating a new program.** Exactly one program is active at a time. Archived programs are kept forever (never deleted) and can be viewed read-only. Creating a new program is blocked while a session is in progress.
3. **Progression and History span programs.** Because progression state is per exercise (see Data model), a new program that reuses an exercise picks up from that exercise's most recent completed session, regardless of which program it was logged under. Typing an exercise name that matches an existing exercise (case-insensitive) reuses it so history continues.
4. **RPE goal is per slot**, not a global 8. Each slot sets `targetRpe` (6.5–10 in half steps, default 8). Suggestions land `reps @ targetRpe`. The progression rules' "RPE ≤ 9 / RPE > 9" cutoff generalizes to **cutoff = min(targetRpe + 1, 10)**: a set at or below the cutoff can progress; above it holds (single) or recalculates (double). With `targetRpe = 8` this is identical to v1, so every worked example above is unchanged.
5. **Builder inputs per slot:** exercise name (typed, with type-ahead reuse), sets, reps (fixed target → single progression; min–max range → double progression), RPE goal, starting load. Load increment is set on the exercise (default 5 lb).
6. **Sets over 12 reps** keep the v1 fallback (no e1RM, +1 increment on success, "low confidence"). The builder shows a hint on any slot whose `reps + (10 − targetRpe)` exceeds the table (15.5). Extrapolating the table is a v2 idea.
7. **Rule clarifications adopted during implementation:**
   - "Most recent session" means the most recent **completed** session containing the exercise. In-progress sessions are excluded; abandoned sessions are deleted.
   - "Hold" means set 1's **logged** load, not the previous suggestion.
   - Double progression evaluates in this order: `reps < repMin` → recalc `repMin @ goal`; `rpe > cutoff` → recalc `min(reps, repMax) @ goal` (no floor, no bump); `reps > repMax` → progress to `repMin @ goal` (with the rounding bump); otherwise hold and "beat last time's set 1".
   - The "big jump" check compares the **rounded** suggested load to the last logged load (so the over-performing example's 260/235 = +10.6% flags, while the raw 257.9 would not).
   - Finish requires load + reps on every set and RPE on set 1; later-set RPE is optional. Finishing with unlogged slots is allowed after a confirmation listing them; unlogged exercises don't update.
   - The same exercise can't appear twice in one day.
   - A session snapshots its plan at Start. Editing the active program mid-session is allowed; the pointer advance uses `(session.dayIndex + 1) % days.length` against the live program.
8. **RTS table verified** (2026-11-03) against two independent reproductions of the Tuchscherer/RTS chart; all 30 values match. The engine's tests include a full 12-rep × 8-RPE grid check.

---

## v1.2 amendments (2026-11-03)

These supersede the matching v1 and v1.1 sections above: the Data model's `Slot.startingLoad` line and `SetLog` block, the first sentence of "Fallback (no usable e1RM)", the "suggested load" wording in Screens items 1–3 and the Override paragraph (a first session has nothing to prefill), and v1.1 amendment 5. Every worked example and asserted number above is unchanged.

1. **No starting load.** `Slot.startingLoad` is removed from the data model, the program builder, and the engine's slot parameters (not kept as an optional field). A slot has no load of its own; loads come only from logged sets. There is no load field anywhere in the builder.

2. **First session.** An exercise with no completed session anywhere (any day, any program, including archived ones) is a *first session*. The engine returns `{ load: null, repTarget, targetRpe, confidence: 'normal', bigJump: false, reason: 'first-session', e1rm: null, basis: null }`. "First session" is decided per **exercise**, never per slot: a shared exercise logged on Day A is not a first session on Day B, and a new program that reuses an exercise picks up its history. Today shows the rep target only — "5 reps @ 8" or "6–8 reps @ 8" — with "First session — log the weight you use" and no "Last set 1" line.

3. **Logging a first session.** Starting a session pre-creates one row per set with **no `load` and no `suggestedLoad`** (both fields are optional and absent until there is a value). The load inputs open empty with an "lb" placeholder; the lifter types the weight they actually use. Typing set 1's load also fills every later set whose load still equals what set 1 last filled them with (the prefilled suggestion, or on a first session nothing at all); a later set the lifter already edited is left alone, clearing set 1 never clears the others, and retyping set 1 after clearing it fills the linked sets again — so backspacing a wrong number can never leave a stray partial load on sets 2+. The log screen's suggestion line reads "First session — type set 1's load; it fills the rest". Finish still requires a load above 0 and reps on every logged set and an RPE on set 1: an empty load blocks with "<Exercise> set N: enter the load", a typed 0 with "<Exercise> set N: load must be above 0". A slot with no reps on any set is still "skipped" after the confirmation, its rows (typed loads included) are deleted, and it remains a first session. Abandoning deletes everything, so the next attempt is a first session again.

4. **From the second session on, nothing changes.** Suggestions build from the logged sets exactly as in v1/v1.1: set 1's e1RM, the per-slot RPE goal, rounding to the exercise increment, the +1% floor, and the big-jump flag measured against set 1's logged load. A conservative first-session weight will often flag "big jump" on the second session (e.g. 185 × 9 @ 7 on a 6–8 slot → 215, +16%); that is the intended sanity check, not a bug. The fallback section's "first session (use startingLoad)" clause is gone: the fallback applies only when there is history but no usable e1RM. A completed session never contributes a row without a load: Finish enforces it, and the queries that feed the engine and History ignore any row that lacks one.

5. **Rep scheme in the builder** (replaces v1.1 amendment 5). Each slot sets: exercise name (typed, with type-ahead reuse); a two-button toggle **Fixed reps / Rep range** (fixed → single progression, range → double progression) with a one-line hint of what the choice means; then Sets + Target reps, or Sets + Min reps + Max reps; RPE goal. The load increment stays per exercise (default 5 lb). Switching keeps the numbers already typed (Fixed 5 → Range 5–7; Range 6–8 → Fixed 6). A range needs Max above Min; equal or inverted values are rejected at save with "<Day>: rep range must be like 6–8".

6. **Data model** (replaces the matching lines of the v1 block):
```
Slot
  id, exerciseId, sets, targetRpe
  progression: "single" | "double"
  // single:  targetReps
  // double:  repMin, repMax

SetLog
  id, sessionId, slotId, exerciseId, setNumber
  load? (lb)        // absent on a first session until typed
  reps?, rpe?       // rpe in 0.5 steps
  suggestedLoad?    // absent on a first session
```

7. **Backups.** The backup `schemaVersion` and the Dexie schema version both stay at 1. A backup whose slots still carry `startingLoad` imports; the key is dropped on import and the value is ignored. Saving a program also drops it, so a program built on an older build loses the key on its next save. Sessions and sets import unchanged.

8. **Testing additions.** The engine asserts `load === null` for, and only for, the first session. The data-layer tests cover a range slot from an empty first session through the 185 × 9 @ 7 → 215 example and then the hold branch (215 × 7 @ 8 → stay at 215, beat 7), the first-session Finish messages, the absent-key convention, an abandoned and a skipped first session, a completed row without a load being ignored, Max-above-Min validation, and import of a v1 backup. The browser smoke test builds a program with a Fixed slot on Day A and a Range slot on Day B, logs both first sessions from empty inputs (checking copy-down from set 1), and asserts 230 × 5 @ 8 and 215 × 6–8 @ 8 with the big-jump badge, History e1RMs 286 and 272, export/reset/import, and import of a legacy file.

---

## v1.3 amendments (2026-11-03)

1. **Warm-ups.** Each day has an ordered list of warm-up items that are **checkbox only**: a name and an optional note (e.g. "3 × 4 with 4–6 kg"), no load, reps or RPE, no progression, not in History. Data model: `Day.warmups?: WarmupItem[]` with `WarmupItem { id, name, note? }`. Starting a session snapshots them onto the session as `Session.warmups?: WarmupLog[]` (`{ id, name, note?, done }`, all `done: false`); ticking a box writes through immediately. Warm-ups never block Finish and are not required. Days and sessions from before v1.3 have no `warmups` field and behave as an empty list. The builder edits warm-ups above the exercises of each day; Today lists their names under the day heading; the log screen shows them as a checklist above the first exercise.

2. **Preloaded program.** The app ships one template (`src/db/templates.ts`, `PRELOADED`): Matt's Tuesday / Thursday program. Loading it creates the exercises (reusing any existing exercise with the same name, case-insensitive) and makes the program active, archiving the current one like any new program. It is offered on first launch ("Use preloaded program" next to "Build from scratch") and in the New program dialog as a third source alongside "Empty program" and "Copy of the current program". Loads are still picked in each exercise's first session; every slot's RPE goal is 8 and every exercise's increment is 5 lb.

   | Day | Warm-up (checkbox) | Exercises |
   |---|---|---|
   | Tuesday | 90/90 hips · Open books · Jump (3 × 5) · Underhand Scoop (3 × 4 with 4–6 kg) | Squat 3 × 4–6 · DB Bench 3 × 6–8 · DB SLDL 3 × 10 · Chin 3 × 6–10 · Pallof Press 3 × 10 · DB Incline Curl 2 × 12–15 |
   | Thursday | 90/90 hips · Open books · Jump (3 × 5) · Step-through Put (3 × 4 with 4–6 kg) | Trap 3 × 4–6 · DB Press 3 × 8–10 · BSS 3 × 8 · DB Row 3 × 10 · Cable chop 3 × 10 · DB OTE 2 × 12–15 |

   `N × a–b` is a rep range (double progression); `N × r` is fixed reps (single progression). Sets of 13–15 reps (the 12–15 slots) are past the RTS chart, so those slots get the one-increment fallback and a "low confidence" badge, as in v1.2.

3. **New program dialog.** The "Start from a copy" checkbox became a three-way choice: Empty program / Copy of the current program / Preloaded.

## v1.4 amendments (2026-11-06)

1. **Exercise swaps and additions mid-session.** On the log screen every exercise card has **Swap exercise**, and the list ends with **Add exercise**. Both open the same dialog: exercise name (type-ahead over existing exercises; a new name creates the exercise with the default 5 lb increment), sets, fixed reps or a rep range, RPE goal, and a scope choice:
   - **Just this session** — only the session's plan snapshot changes. The program is untouched, so the next time that day comes round it is as the builder left it.
   - **This and future sessions** — the program's day is edited too: a swap rewrites the slot in place (same position, new exercise and scheme); an add appends a slot. The program must still be active and the day still exist, else the dialog asks to apply it to just this session.

   A swap starts from the slot's current scheme (e.g. 3 × 4–6 @ 8); an add starts from 3 × 5 @ 8. The swapped-in or added exercise gets the usual suggestion from its own history (or a first session with no load). Rows already logged for a swapped-out exercise are discarded; the dialog says so. The same exercise can't appear twice in a session or on a program day. The card shows a note: "Swapped in for Squat · this and future sessions" or "Added · this session only". History, progression and Finish treat such slots like any other.

   Data model: `PlannedSlot.change?: { kind: 'swap' | 'add'; scope: 'session' | 'program'; replaced?: string }`. A swap keeps the slot id (so a later swap of the same card, with program scope, still replaces the same program slot); its set rows are deleted and recreated. Implementation: `src/state/slotChanges.ts` (`swapExercise`, `addExercise`), one transaction over sessions, setLogs and programs.

## v1.5 amendments (2026-11-06)

1. **Suggested warm-up sets.** Once an exercise has a suggested working load, its card lists warm-up sets as checkbox-only chips ("130 × 6", "170 × 3") above the working sets: no RPE, not logged, not in History, never required to Finish. A first session has no working load and so gets none. The list is snapshotted onto the session (`PlannedSlot.warmupSets?: { load, reps, done }[]`), ticks write through immediately, and a swap or add recomputes it for the new exercise. Today shows the same list as a line under the suggestion.

   The rule (`src/engine/warmup.ts`) is a synthesis of coaching sources, not a published table. Points the sources agree on: warm-ups ramp from light to the working weight and stop a point or two of RPE short of it, so none is recorded; the heaviest warm-up lands around 80–90 % of the working load; the number of sets scales with the load and drops for lower reps; dumbbell / cable / machine work needs one or two sets and isolation work none; and there is nothing to warm up to until a working weight exists.

   | Lift class (from the name) | Working load (lb) | Sets, as % of the working load | Reps |
   |---|---|---|---|
   | Main (barbell, trap bar, unknown) | < 95 | none | |
   | | 95–154 | 60 | |
   | | 155–224 | 60, 80 | 40 % and 60 %: min(target, 8) |
   | | 225–314 | 40, 60, 80 | 80 %: min(target, 3) |
   | | ≥ 315 | 40, 60, 80, 90 | 90 %: min(target, 2) |
   | Main with a target of ≤ 3 reps | | one tier higher (max 4 sets) | |
   | Light (name starts "DB", "Dumbbell", "Cable", "Machine", "KB", "Band", "Smith", or contains "pulldown", "leg press", …) | < 30 | none | |
   | | 30–99 | 60 | |
   | | ≥ 100 | 60, 80 | |
   | Isolation (name contains "curl", "raise", "extension", "OTE", "pushdown", "fly", "face pull", "Pallof", "shrug", "calf", "plank", …) | any | none | |
   | Bodyweight exercise | any | BW × min(target, 5); plus 60 % of the added weight × min(target, 3) when ≥ 30 lb is added | |

   Loads round to the exercise's increment; a rung that rounds onto the previous one or within one increment of the working load is dropped. The target for a rep range is its bottom. Worked examples: Squat 230 × 5 → 90 × 5, 140 × 5, 185 × 3. Bench 215 × 6–8 → 130 × 6, 170 × 3. Trap bar 315 × 4–6 → 125 × 4, 190 × 4, 250 × 3, 285 × 2. DB Bench 70 × 6–8 → 40 × 6. DB Incline Curl → none.

   Sources (fetched 2026-11-06): Barbell Medicine forum, Jordan Feigenbaum: 3–5 sets evenly spaced from the bar to the working weight, same reps, last one 1–2 RPE under, 1–2 sets for dumbbell work, none until a weight is known — https://forum.barbellmedicine.com/t/how-should-i-warm-up/6369 , https://forum.barbellmedicine.com/t/how-to-warm-up-to-find-the-correct-weight-for-the-prescribed-intensity/11238 , https://forum.barbellmedicine.com/t/dumbell-press-on-powerbuilding-1-0/5717 . RTS, "Beginning RTS": RPE below 7 is warm-up territory; work up by feel — https://store.reactivetrainingsystems.com/blogs/rts-basics/beginning-rts . Stronger By Science, Milo Wolf 2024: the heavier (~80 %) warm-up set is the one that improves performance; 1–2 sets — https://www.strongerbyscience.com/heavier-warm-ups/ . Percent ladders: Hevy 40/60/80 — https://www.hevyapp.com/warm-up-sets/ ; Lift Vault 40/55/70/85 with tapering reps — https://liftvault.com/resources/warmup-set-calculator/ ; A Workout Routine (isolation and dumbbell work needs little or none) — https://www.aworkoutroutine.com/warm-up-sets/ ; 5/3/1 40/50/60 % × 5/5/3 (secondary: thefitness.wiki). Starting Strength's 3–5 sets with tapering reps could only be read from secondary sources (startingstrength.com returned 403). Judgment calls, not sourced: the exact load tiers (95/155/225/315), the name keyword lists, the per-rung rep caps, and the bodyweight scheme.

2. **Bodyweight exercises.** `Exercise.bodyweight` (toggle beside Increment in the builder, and in the swap / add dialog; the preloaded Chin is flagged) means the logged load is *added* weight. Rows show "BW" as the placeholder and may be left empty; Finish stores them as a load of 0, which History and progression accept only for bodyweight slots (`checkFinish` still rejects an empty or zero load elsewhere). A negative added weight is refused. Display is "BW" or "BW +25" everywhere a load appears. Progression (`src/engine/bodyweight.ts`) makes the single / double decisions on reps and RPE alone, since an e1RM from added weight means nothing: progress → one increment more, the recalc branches → one increment less (never below 0), hold → same; confidence is normal and no e1RM is shown. Snapshotted on the session as `PlannedSlot.bodyweight`.

## v1.6 amendments (2026-11-06)

1. **Linear progression rule.** Each slot has a progression rule: `rpe` (the v1 rules: next load from set 1's e1RM at the RPE goal) or `linear` (`Slot.rule`). Linear: when every set hits its target — the fixed rep count, or the **top** of a rep range — the next load is the last load plus one increment; otherwise the load holds. Fixed-rep slots only: a miss in two consecutive completed sessions drops the load 10 % (rounded to the increment, and always at least one increment down) to build back up. Rep-range slots never deload: sets inside the range are the normal state of double progression, as the program describes. RPE is still logged and shown but doesn't drive the load, and linear slots have no RPE goal: their sets colour on reps alone, and the pill reads "3 × 5" without "@ 8". The suggestion needs the last two completed sessions of the exercise (`getRecentCompletedSets`). Reasons: `linear-progress`, `linear-hold-missed` (fixed reps), `linear-hold-range`, `linear-deload`. Implementation: `src/engine/linear.ts`. The builder and the swap / add dialog offer "By RPE / Linear".

2. **Intro weeks.** `Program.introWeeks` and `Slot.introSets`: for that many weeks after the program was created, slots with an intro count run that many sets instead of `sets` (`PlannedSlot.fullSets` remembers the full count; Today and the card say "intro"). The builder has an Intro weeks field on the program, an Intro starts date (`Program.introStartsAt`, default: the creation date; sessions before it are "week 0" and use the intro counts too), and an Intro sets field per exercise when intro weeks are set. The intro ends `introWeeks` after the start date.

3. **Supersets and order labels.** `Slot.supersetWithPrev` pairs a slot with the one above it (ignored on the first slot of a day). Every exercise carries a blue order label on Today, the log screen and the builder: "1", "2", … by position on the day, and the members of a superset share the number with a letter, "5A / 5B" (`orderLabels` in `src/state/plan.ts`). Since v1.7 §3 a superset is shown as consecutive ordinary cards joined by a "superset" link; the Enter flow follows the alternating order (5A set 1, 5B set 1, 5A set 2 …). Copy-down of set 1's load stays within its own exercise. Only the first exercise of a superset gets suggested warm-up sets. Today groups the pair in one card. A swap keeps the slot's place in the superset, and a swap during the intro weeks keeps the intro count (the dialog is seeded with the full count; changing it drops the intro count). Accessible names on superset rows are "<exercise> set N load/reps/RPE".

4. **Preloaded "3x Lifting".** A second template (`THREE_DAY` in `src/db/templates.ts`), offered first on first launch and in New program. Three full-body days, two intro weeks, main lifts linear (Back Squat 5 lb, Bench Press 5 lb, Deadlift 10 lb, Overhead Press 2.5 lb increments), accessories as rep ranges at an RPE goal of 8 (about two reps in reserve) with the linear rule (add the increment once every set reaches the top of the range), A1/A2 supersets as written. Matt's choices (2026-11-06): "Hanging Leg Raise or Ab Wheel" is Ab Wheel (bodyweight); the Day 1 and Day 3 lateral raises are the same exercise ("Lateral Raise"). Judgment call: "(1-2)" intro counts are 1. Day 1 and Day 3 share Back Squat, Bench Press, Lateral Raise and Face Pull, so those progress across both days. The program's rest guidance (3–5 min main lifts, 90 s–2 min accessories) and stall advice (Day 3 bench variation, Day 3 squat at 80–90 %, light OHP on Day 1 if OHP stalls) are not modelled; use the swap feature for the variations.

   | Day | Exercises (sets × reps; intro sets in brackets) |
   |---|---|
   | Day 1 | Back Squat 3 × 5 · Bench Press 3 × 5 · Chest-Supported Row 4 × 8–12 (2) · Romanian Deadlift 3 × 8–12 (2) · A1 Lateral Raise 3 × 12–20 (2) / A2 Face Pull 2 × 12–20 (2) · Calf Raise 3 × 10–15 (2) |
   | Day 2 | Deadlift 2 × 5 · Overhead Press 3 × 5 · Bulgarian Split Squat 3 × 8–12 (2) · A1 Lat Pulldown 4 × 8–12 (2) / A2 Incline DB Press 3 × 8–12 (2) · A1 Curl 3 × 10–15 (2) / A2 Calf Raise 3 × 10–15 (2) · Ab Wheel 3 × 8–15 (2), bodyweight |
   | Day 3 | Back Squat 3 × 5 · Bench Press 3 × 5 · DB Reverse Lunge 2 × 8–12 (1) · A1 Cable Row 3 × 8–12 (2) / A2 Leg Curl 3 × 10–15 (2) · A1 Overhead Extension 3 × 10–15 (2) / A2 Hammer Curl 2 × 10–15 (1) · A1 Lateral Raise 3 × 12–20 (2) / A2 Face Pull 2 × 12–20 (2) |

## v1.7 amendments (2026-11-06)

1. **Log-screen entry flow.** Enter (the keyboard's Next key) on a set's load moves to its reps; Enter on reps moves to its RPE; Enter on the RPE moves to the next set on screen (its load if still empty, else its reps), crossing into the next card and following superset order (5A set 1, 5B set 1, 5A set 2 …).

2. **Typed RPE.** The RPE cell is a text field like load and reps (decimal keypad). The stored value is the nearest half step from 6 to 10; anything typed under 6 is stored as "<6" (`RPE_BELOW_6 = 5`, `toLoggedRpe` in `src/engine/rpeTable.ts`) and the field reads "<6" when it isn't focused. RPE 6 is now on the chart (`RPE_MIN = 6`; the RTS table covers it for sets up to 11 reps). "<6" is never rated for an e1RM, so on a by-RPE slot a "<6" set 1 falls back to the one-increment rule (low confidence); on a linear slot it is just a note. It colours as "easy" against any goal. The field carries the set's colour like the old chip did. (The docked RPE bar tried earlier in v1.7 was dropped the same day.) The RPE goal picker in the builder now runs 6–10.

3. **Supersets are ordinary cards in one frame.** A superset's exercises render as normal cards (5A, 5B …) inside one blue-bordered frame, with a "— superset —" divider between them; nothing is highlighted and no set is marked "next" (both earlier v1.7 layouts, interleaved rounds and per-exercise blocks with a next marker, were dropped as too busy). Inside a superset the accessible names carry the exercise ("Lateral Raise set 1 load"). Today shows the same linked cards.
