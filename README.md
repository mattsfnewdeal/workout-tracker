# Workout Tracker

A personal lifting tracker that runs as a PWA on iPhone. One user, no backend, no accounts. Build a weekly program from your own exercises, log load / reps / RPE per set, and get next session's load suggested from an RPE-based estimated 1RM.

Spec: [SPEC.md](SPEC.md). Live: https://mattsfnewdeal.github.io/workout-tracker/

## How it works

- **Program**: one active program at a time, a repeating cycle of days. Each day has checkbox-only warm-up items and exercise slots with sets, fixed reps or a rep range, and an RPE goal. An exercise’s first session has no suggested load: you type the weight you use and progression builds from it. Mid-session you can swap an exercise or add one, either for just that session or for the program's day from then on. Bodyweight exercises (chins, dips) log added weight and may be left empty. Once an exercise has a working load its card suggests checkbox-only warm-up sets, scaled to the load and the kind of lift (see the spec for the rule and its sources). Creating a new program archives the old one; history and progression carry over per exercise. Two preloaded programs (`src/db/templates.ts`) are one tap away on first launch and under New program. Each slot progresses either by RPE (load from e1RM) or linearly (add the increment when every set hits its target, deload after two misses); days can have supersets (A1/A2, logged in rounds) and a program can run reduced set counts for its first weeks.
- **Suggestions**: set 1 of the exercise's most recent completed session gives an e1RM via the RTS/Tuchscherer chart (`%1RM` keyed by `reps + (10 − RPE)`). The next load lands the rep target at the RPE goal, rounded to the exercise's increment. Single progression needs every set clean and adds at least +1%; double progression moves up once set 1 beats the top of the range. Sets over 12 reps fall back to one-increment steps and are flagged low confidence. Details and worked examples in the spec.
- **Storage**: IndexedDB (Dexie). Safari can evict it, so Settings has Export / Import JSON and shows the last backup date.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173/workout-tracker/
npm test           # vitest: engine + data layer (fake-indexeddb)
npm run build      # tsc --noEmit && vite build → dist/
npm run preview    # serve dist/ at http://localhost:4173/workout-tracker/
npm run icons      # regenerate public/*.png from public/icon.svg
npm run smoke      # browser smoke test of the full flow against `npm run preview` (uses the installed Chrome; CHROME_PATH / BASE_URL to override)
```

Layout: `src/engine` (pure progression math, fully unit-tested), `src/db` (Dexie schema, queries, session transactions, backup), `src/state` (plan builder, in-progress session hook), `src/ui` (Preact screens, hash router).

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: tests → build → GitHub Pages. The site is served under `/workout-tracker/`, which is why `vite.config.ts` sets `base` and the app uses hash routes.

First-time setup (already done): `gh repo create mattsfnewdeal/workout-tracker --public` and set the Pages source to GitHub Actions.

## On the phone

Open the live URL in Safari → Share → Add to Home Screen. Launch from the icon for standalone mode; it works offline after the first load. Export a backup from Settings now and then and save it to Files.

## Restore from backup

Settings → Import JSON → pick the backup file → confirm. This replaces everything on the device.
