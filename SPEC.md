# Workout Tracker — Spec (v1.1)

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
- **Working range is RPE 7–9.** Highlight any logged set outside it.
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
   - Sets outside RPE 7–9 are highlighted.
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
