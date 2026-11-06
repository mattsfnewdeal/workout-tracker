import { chromium } from 'playwright-core';
import fs from 'node:fs';

fs.mkdirSync('.smoke', { recursive: true });
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/workout-tracker/';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const errors = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
// Desktop Chrome exposes navigator.share; stub it so export takes the download path deterministically.
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n   ', e.message.split('\n')[0]); await page.screenshot({ path: `.smoke/FAIL-${name.replace(/\W+/g, '_')}.png` }); throw e; } };
const text = async (sel) => (await page.locator(sel).first().innerText()).trim();
const shot = (n) => page.screenshot({ path: `.smoke/${n}.png`, fullPage: true });
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const waitValue = async (loc, want, ms = 2000) => { const t = Date.now(); for (;;) { const v = await loc.inputValue(); if (v === want) return; if (Date.now() - t > ms) throw new Error(`value "${v}" != "${want}"`); await page.waitForTimeout(50); } };
const cardText = () => text('li.card');
const setRow = (n) => page.locator('.set-row').nth(n);
const rpeChip = (row) => setRow(row).getByLabel(/^Set \d+ RPE$/);
/** Type an RPE and leave the field, as a lifter would; the field then reads the normalised value. */
const typeRpe = async (field, value) => { await field.fill(value); await field.press('Tab'); };
const pickRpe = (row, value) => typeRpe(rpeChip(row), value);
const activeLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

await step('fresh app shows empty state', async () => {
  await page.goto(BASE);
  await page.getByText('No program yet.').waitFor();
  await shot('01-today-empty');
});

await step('create a program: Squat 3×5 fixed on Day A, Bench Press 3×6–8 range on Day B', async () => {
  await page.getByRole('button', { name: 'Build a program' }).click();
  await page.getByText('You’ll pick each weight in your first session.').waitFor();
  await page.getByRole('button', { name: 'Build from scratch' }).click();
  await page.getByLabel('Day name').first().waitFor();
  const dayA = page.locator('section.card').nth(0);
  await dayA.getByPlaceholder('Exercise name').fill('Squat');
  await dayA.getByRole('button', { name: 'Add exercise' }).click();
  await dayA.locator('strong', { hasText: 'Squat' }).waitFor();
  assert((await dayA.getByLabel('Starting load (lb)').count()) === 0, 'starting load field still present');
  assert((await dayA.getByRole('radio', { name: 'Fixed reps' }).getAttribute('aria-checked')) === 'true', 'fixed not selected by default');
  assert((await dayA.getByLabel('Target reps').inputValue()) === '5', 'target reps default');
  assert((await dayA.getByLabel('Increment (lb)').inputValue()) === '5', 'increment default');

  const dayB = page.locator('section.card').nth(1);
  await dayB.getByPlaceholder('Exercise name').fill('Bench Press');
  await dayB.getByRole('button', { name: 'Add exercise' }).click();
  await dayB.locator('strong', { hasText: 'Bench Press' }).waitFor();
  await dayB.getByRole('radio', { name: 'Rep range' }).click();
  assert((await dayB.getByRole('radio', { name: 'Rep range' }).getAttribute('aria-checked')) === 'true', 'range not selected');
  await dayB.getByLabel('Min reps').fill('6');
  await dayB.getByLabel('Max reps').fill('8');
  assert((await dayB.innerText()).includes('beats the top of the range'), 'range hint missing');
  await shot('02-program-editor');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Saved', { exact: true }).first().waitFor();
});

await step('Today shows a first session with no load', async () => {
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Day A').waitFor();
  const big = await text('li.card .big-number');
  assert(big === '5 reps @ 8', `big number "${big}"`);
  const t = await cardText();
  assert(t.includes('First session') && !t.includes('×'), t);
  await shot('03-today-first');
});

await step('start Day A: loads start empty, set 1 copies down', async () => {
  await page.getByRole('button', { name: 'Start Day A' }).click();
  await page.waitForURL(/#\/log\//);
  for (const n of [1, 2, 3]) {
    const load = page.getByLabel(`Set ${n} load`);
    assert((await load.inputValue()) === '', `set ${n} load not empty`);
    assert((await load.getAttribute('placeholder')) === 'lb', `set ${n} placeholder`);
  }
  assert((await cardText()).includes('type set 1'), 'first-session hint missing on log screen');
  await page.getByLabel('Set 1 load').fill('225');
  await waitValue(page.getByLabel('Set 2 load'), '225');
  await waitValue(page.getByLabel('Set 3 load'), '225');
  // an edited later set is left alone; clearing set 1 never clears the others; retyping set 1 re-fills the linked ones
  await page.getByLabel('Set 3 load').fill('235');
  await page.getByLabel('Set 1 load').fill('230');
  await waitValue(page.getByLabel('Set 2 load'), '230');
  assert((await page.getByLabel('Set 3 load').inputValue()) === '235', 'edited set 3 was overwritten by copy-down');
  await page.getByLabel('Set 1 load').fill('');
  await page.waitForTimeout(100);
  assert((await page.getByLabel('Set 2 load').inputValue()) === '230', 'clearing set 1 cleared set 2');
  await page.getByLabel('Set 1 load').fill('225');
  await waitValue(page.getByLabel('Set 2 load'), '225');
  assert((await page.getByLabel('Set 3 load').inputValue()) === '235', 'set 3 should still hold its own value');
  await page.getByLabel('Set 3 load').fill('225');
  for (const n of [1, 2, 3]) await page.getByLabel(`Set ${n} reps`).fill('5');
  // Enter flow: load → reps → RPE bar → (pick) → next set
  await page.getByLabel('Set 1 load').focus();
  await page.keyboard.press('Enter');
  assert((await activeLabel()) === 'Set 1 reps', `Enter on load should focus reps, got ${await activeLabel()}`);
  await page.keyboard.press('Enter');
  assert((await activeLabel()) === 'Set 1 RPE', `Enter on reps should focus RPE, got ${await activeLabel()}`);
  await page.keyboard.type('7');
  await page.keyboard.press('Enter');
  assert((await activeLabel()) === 'Set 2 reps', `Enter on RPE should move to set 2's reps (its load is filled), got ${await activeLabel()}`);
  assert((await rpeChip(0).inputValue()) === '7', 'RPE 7 should be kept');
  await pickRpe(1, '5.5'); // under 6 → stored as <6, 'easy' (blue)
  assert((await rpeChip(1).inputValue()) === '<6', `field should read <6, got ${await rpeChip(1).inputValue()}`);
  await pickRpe(2, '6');
  assert((await rpeChip(2).inputValue()) === '6', `6 is a real RPE and must read 6, got ${await rpeChip(2).inputValue()}`);
  await pickRpe(2, '7.3'); // snaps to the nearest half step
  assert((await rpeChip(2).inputValue()) === '7.5', `7.3 should snap to 7.5, got ${await rpeChip(2).inputValue()}`);
  await pickRpe(2, '12');
  assert((await rpeChip(2).inputValue()) === '10', '12 should cap at 10');
  await pickRpe(2, '');
  assert((await rpeChip(2).inputValue()) === '', 'clearing the field clears the RPE');
  await shot('04-log');
  assert((await page.locator('.set-row.easy').count()) === 1 && (await page.locator('.set-row.good').count()) === 2, 'expected 2 good rows and 1 easy row');
});

await step('session survives a reload and shows Resume on Today', async () => {
  await page.waitForTimeout(250); // let the write-through land before we drop the page
  await page.reload();
  await page.getByLabel('Set 1 reps').waitFor();
  assert((await page.getByLabel('Set 1 reps').inputValue()) === '5', 'reps lost');
  assert((await page.getByLabel('Set 3 load').inputValue()) === '225', 'copied-down load not persisted');
  assert((await rpeChip(0).inputValue()) === '7' && (await rpeChip(1).inputValue()) === '<6', 'rpe lost');
  await page.goto(BASE + '#/');
  await page.getByText('Day A in progress').waitFor();
  await shot('05-today-resume');
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForURL(/#\/log\//);
});

await step('finish advances to Day B, whose range slot is a first session', async () => {
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByText('Next: Day B').waitFor();
  const big = await text('li.card .big-number');
  assert(big === '6–8 reps @ 8', `big number "${big}"`);
  assert((await cardText()).includes('First session'), 'not a first session');
  assert(!(await cardText()).includes('Warm-up sets'), 'a first session must not suggest warm-up sets');
  await shot('06-today-dayB-first');
});

await step('start Day B and log 185 × 9 @ 7, 8, 7', async () => {
  await page.getByRole('button', { name: 'Start Day B' }).click();
  await page.waitForURL(/#\/log\//);
  assert((await page.getByLabel('Set 1 load').inputValue()) === '', 'bench load should start empty');
  await page.getByLabel('Set 1 load').fill('185');
  await waitValue(page.getByLabel('Set 2 load'), '185');
  await waitValue(page.getByLabel('Set 3 load'), '185');
  for (const [i, r] of ['9', '8', '7'].entries()) await page.getByLabel(`Set ${i + 1} reps`).fill(r);
  await pickRpe(0, '7');
  assert((await page.locator('.set-row.good').count()) === 3, 'all three bench sets should be good');
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByText('Next: Day A').waitFor();
});

await step('pointer wrapped to Day A → 230 × 5 @ 8', async () => {
  const t = await cardText();
  for (const s of ['230 × 5 @ 8', 'All sets clean', 'Last set 1: 225 × 5 @ 7', 'Warm-up sets: 90 × 5, 140 × 5, 185 × 3']) assert(t.includes(s), `missing "${s}" in: ${t}`);
  assert(!t.includes('big jump'), 'unexpected big jump');
  await shot('07-today-230');
});

await step('point to Day B → double progression suggests 215 × 6–8 @ 8 with big jump', async () => {
  await page.getByRole('link', { name: 'Program' }).click();
  await page.getByLabel('Next session').selectOption('1');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Saved', { exact: true }).first().waitFor();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Day B').waitFor();
  const t = await cardText();
  for (const s of ['215 × 6–8 @ 8', 'Beat the top of the range', 'big jump', 'Last set 1: 185 × 9 @ 7', '(range 6–8)']) assert(t.includes(s), `missing "${s}" in: ${t}`);
  assert(!t.includes('beat 9'), 'unexpected beat badge');
  assert(t.includes('Warm-up sets: 130 × 6, 170 × 3'), `warm-up sets missing in: ${t}`);
  await shot('08-today-215');
});

await step('warm-up sets in a session are checkboxes that persist and never block', async () => {
  await page.getByRole('button', { name: 'Start Day B' }).click();
  await page.waitForURL(/#\/log\//);
  const w1 = page.getByRole('checkbox', { name: 'Bench Press warm-up 130 × 6' });
  const w2 = page.getByRole('checkbox', { name: 'Bench Press warm-up 170 × 3' });
  await w1.waitFor();
  assert((await page.locator('.warmup-set').count()) === 2, 'expected two warm-up chips');
  assert((await page.locator('.set-row').count()) === 3, 'warm-ups must not add set rows');
  await w1.check();
  await page.waitForTimeout(250);
  await shot('08b-log-warmup-sets');
  await page.reload();
  await w1.waitFor();
  assert(await w1.isChecked(), 'warm-up tick lost on reload');
  assert(!(await w2.isChecked()), 'second warm-up should be unticked');
  await page.getByRole('button', { name: 'Abandon' }).first().click();
  await page.getByRole('button', { name: 'Abandon', exact: true }).last().click();
  await page.getByText('Next: Day B').waitFor();
});

await step('history shows e1RM 286 for Squat and 272 for Bench Press', async () => {
  await page.getByRole('link', { name: 'History' }).click();
  await page.getByLabel('Exercise').selectOption({ label: 'Squat' });
  await page.getByText('e1RM from set 1: 286').waitFor();
  await page.getByLabel('Exercise').selectOption({ label: 'Bench Press' });
  await page.getByText('e1RM from set 1: 272').waitFor();
  await shot('09-history');
});

let backupPath;
let backupJson;
await step('export backup via download fallback and record last backup', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByText('Last backup: never').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  backupPath = `${process.cwd()}/.smoke/${download.suggestedFilename()}`;
  await download.saveAs(backupPath);
  backupJson = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert(backupJson.app === 'workout-tracker' && backupJson.setLogs.length === 6, `unexpected backup shape: ${backupJson.setLogs?.length} sets`);
  const slots = backupJson.programs[0].days.flatMap((d) => d.slots);
  assert(slots.every((s) => !('startingLoad' in s)), 'startingLoad leaked into the backup');
  const bench = backupJson.programs[0].days[1].slots[0];
  assert(bench.progression === 'double' && bench.repMin === 6 && bench.repMax === 8, JSON.stringify(bench));
  await page.getByText('Backup exported').waitFor();
  assert(!(await text('main p:has-text("Last backup")')).includes('never'), 'last backup not recorded');
  await shot('10-settings');
});

await step('reset wipes everything', async () => {
  await page.getByRole('button', { name: 'Reset all data' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByText('All data deleted').waitFor();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('No program yet.').waitFor();
});

const importFile = async (path) => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('input[type=file]').setInputFiles(path);
  await page.getByText('Replace everything?').waitFor();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByText('Backup imported').waitFor();
};

await step('preloaded program: Tuesday/Thursday with checkbox warm-ups that persist', async () => {
  await page.getByRole('button', { name: 'Build a program' }).click();
  await page.getByRole('button', { name: 'Use preloaded: Tuesday / Thursday' }).click();
  await page.getByLabel('Day name').first().waitFor();
  assert((await page.getByLabel('Day name').first().inputValue()) === 'Tuesday', 'first day should be Tuesday');
  assert((await page.getByLabel('Warm-up name').count()) === 8, 'expected 4 warm-ups per day');
  await shot('11-program-preloaded');
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Tuesday').waitFor();
  const t = await page.locator('main').innerText();
  for (const s of ['Warm-up: 90/90 hips, Open books, Jump, Underhand Scoop', 'Squat', '4–6 reps @ 8', 'DB SLDL', '10 reps @ 8', 'DB Incline Curl', '12–15 reps @ 8']) assert(t.includes(s), `missing "${s}"`);
  await shot('12-today-preloaded');
  await page.getByRole('button', { name: 'Start Tuesday' }).click();
  await page.waitForURL(/#\/log\//);
  await page.getByRole('checkbox', { name: '90/90 hips' }).check();
  await page.getByRole('checkbox', { name: /Underhand Scoop/ }).check();
  await page.waitForTimeout(250);
  await shot('13-log-warmup');
  await page.reload();
  await page.getByRole('checkbox', { name: '90/90 hips' }).waitFor();
  assert(await page.getByRole('checkbox', { name: '90/90 hips' }).isChecked(), 'warm-up tick lost on reload');
  assert(await page.getByRole('checkbox', { name: /Underhand Scoop/ }).isChecked(), 'scoop tick lost on reload');
  assert(!(await page.getByRole('checkbox', { name: 'Open books' }).isChecked()), 'open books should be unticked');
});

await step('swap Squat → Leg Press for future Tuesdays; add Face Pull just for today; duplicates refused', async () => {
  const squatCard = page.locator('li.card').nth(1);
  await squatCard.getByRole('button', { name: 'Swap exercise' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByText('Swap Squat').waitFor();
  assert((await dlg.getByRole('radio', { name: 'Rep range' }).getAttribute('aria-checked')) === 'true', 'swap should inherit the rep range');
  assert((await dlg.getByLabel('Sets', { exact: true }).inputValue()) === '3' && (await dlg.getByLabel('Min reps').inputValue()) === '4' && (await dlg.getByLabel('Max reps').inputValue()) === '6', 'swap should inherit 3 × 4–6');
  await dlg.getByLabel('Exercise name').fill('Leg Press');
  await dlg.getByLabel(/This and future sessions/).check();
  await shot('14-swap-dialog');
  await dlg.getByRole('button', { name: 'Swap', exact: true }).click();
  await squatCard.locator('.card-title', { hasText: 'Leg Press' }).waitFor();
  const swappedText = await squatCard.innerText();
  assert(swappedText.includes('Swapped in for Squat · this and future sessions'), swappedText);
  assert((await squatCard.getByLabel('Set 1 load').inputValue()) === '', 'leg press should start with no load');

  await page.getByRole('button', { name: 'Add exercise' }).click();
  await dlg.getByText('Add an exercise').waitFor();
  assert((await dlg.getByRole('radio', { name: 'Fixed reps' }).getAttribute('aria-checked')) === 'true', 'add should default to fixed reps');
  await dlg.getByLabel('Exercise name').fill('Face Pull');
  await dlg.getByRole('radio', { name: 'Rep range' }).click();
  await dlg.getByLabel('Min reps').fill('12');
  await dlg.getByLabel('Max reps').fill('15');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  const last = page.locator('li.card').last();
  await last.locator('.card-title', { hasText: 'Face Pull' }).waitFor();
  const addedText = await last.innerText();
  assert(addedText.includes('3 × 12–15 @ 8') && addedText.includes('Added · this session only'), addedText);
  assert((await text('.session-head p')).includes('0 of 7 exercises logged'), await text('.session-head p'));

  await page.getByRole('button', { name: 'Add exercise' }).click();
  await dlg.getByLabel('Exercise name').fill('db bench');
  await dlg.getByRole('button', { name: 'Add', exact: true }).click();
  await dlg.getByText('DB Bench is already in this session').waitFor();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await shot('15-log-swapped');

  await page.reload();
  await page.locator('.card-title', { hasText: 'Leg Press' }).waitFor();
  await page.locator('.card-title', { hasText: 'Face Pull' }).waitFor();
  assert((await page.locator('.card-title', { hasText: 'Squat' }).count()) === 0, 'Squat came back after reload');

});

await step('Chin is bodyweight: logs with no load, shows BW in History, holds at BW next time', async () => {
  const chin = page.locator('li.card', { hasText: 'Chin' });
  assert((await chin.getByLabel('Set 1 load').getAttribute('placeholder')) === 'BW', 'bodyweight rows should show BW');
  assert((await chin.innerText()).includes('leave the load empty for bodyweight'), await chin.innerText());
  for (const n of [1, 2, 3]) await chin.getByLabel(`Set ${n} reps`).fill('8');
  await typeRpe(chin.getByLabel('Set 1 RPE'), '8');
  assert((await chin.locator('.set-row.good').count()) === 3, 'chin sets should be green');
  await chin.locator('.card-head').click();
  assert((await chin.locator('.summary').innerText()).includes('BW × 8 @ 8'), await chin.locator('.summary').innerText());
  await shot('17-log-chin-bw');
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByText('Finish without these?').waitFor();
  await page.getByRole('button', { name: 'Finish anyway' }).click();
  await page.getByText('Next: Thursday').waitFor();

  await page.getByRole('link', { name: 'History' }).click();
  await page.getByLabel('Exercise').selectOption({ label: 'Chin' });
  await page.getByText('e1RM from set 1: —').waitFor();
  const hist = await page.locator('li.card').first().innerText();
  assert(hist.includes('BW') && hist.includes('8'), hist);
  await shot('18-history-chin');

  await page.getByRole('link', { name: 'Program' }).click();
  await page.getByLabel('Next session').selectOption('0');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Saved', { exact: true }).first().waitFor();
  const tue = page.locator('section.card').nth(0);
  assert(await tue.getByLabel('Chin is bodyweight').isChecked(), 'Chin should be flagged bodyweight in the editor');
  assert(!(await tue.getByLabel('Leg Press is bodyweight').isChecked()), 'Leg Press should not be bodyweight');
  await tue.locator('strong', { hasText: 'Leg Press' }).waitFor();
  assert((await tue.locator('strong', { hasText: 'Squat' }).count()) === 0, 'Squat should have been replaced on Tuesday');
  assert((await tue.getByLabel('Min reps').first().inputValue()) === '4', 'swapped slot should keep 4–6');
  assert((await page.locator('strong', { hasText: 'Face Pull' }).count()) === 0, 'one-off Face Pull leaked into the program');
  await shot('16-program-after-swap');

  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Tuesday').waitFor();
  const today = await page.locator('main').innerText();
  assert(today.includes('Leg Press') && !today.includes('Squat') && !today.includes('Face Pull'), today);
  const chinCard = page.locator('li.card', { hasText: 'Chin' });
  const ct = await chinCard.innerText();
  for (const s of ['BW × 6–10 @ 8', 'beat 8', 'Warm-up sets: BW × 5', 'Last set 1: BW × 8 @ 8']) assert(ct.includes(s), `missing "${s}" in: ${ct}`);
  assert(!ct.includes('low confidence'), 'bodyweight must not be low confidence');
  await shot('19-today-chin-hold');
});

await step('3x Lifting: supersets, linear main lifts, intro set counts', async () => {
  await page.getByRole('link', { name: 'Program' }).click();
  await page.getByRole('button', { name: 'New program' }).click();
  await page.getByLabel(/Preloaded: 3x Lifting/).check();
  await page.getByRole('button', { name: 'New program', exact: true }).last().click();
  await page.getByText('Archived “Tuesday / Thursday”').waitFor();
  assert((await page.getByLabel('Day name').first().inputValue()) === 'Day 1', 'first day should be Day 1');
  assert((await page.getByLabel('Intro weeks').inputValue()) === '2', 'intro weeks should be 2');
  // week 0: push the intro start three days out and check the end date moves with it
  const startsAt = new Date(Date.now() + 3 * 86400000);
  const iso = `${startsAt.getFullYear()}-${String(startsAt.getMonth() + 1).padStart(2, '0')}-${String(startsAt.getDate()).padStart(2, '0')}`;
  await page.getByLabel('Intro starts').fill(iso);
  const endsAt = new Date(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate() + 14);
  const endText = endsAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(endsAt.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
  assert((await page.locator('main').innerText()).includes(`(${endText})`), `intro end date should read ${endText}`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Saved', { exact: true }).first().waitFor();
  const day1 = page.locator('section.card').nth(0);
  assert(await day1.getByLabel('Face Pull superset with the exercise above').isChecked(), 'Face Pull should be A2');
  assert(!(await day1.getByLabel('Lateral Raise superset with the exercise above').isChecked()), 'Lateral Raise should be A1');
  const squatEditor = day1.locator('.card', { hasText: 'Back Squat' }).first();
  assert((await squatEditor.getByRole('radio', { name: 'Linear' }).getAttribute('aria-checked')) === 'true', 'Back Squat should be linear');
  assert((await squatEditor.getByRole('radiogroup', { name: 'RPE goal' }).getByRole('radio', { checked: true }).count()) === 0, 'main lifts should have no RPE goal selected');
  assert((await day1.locator('.card', { hasText: 'Chest-Supported Row' }).first().getByRole('radio', { name: '8', exact: true }).getAttribute('aria-checked')) === 'true', 'accessories keep an RPE goal of 8');
  const rowEditor = day1.locator('.card', { hasText: 'Chest-Supported Row' }).first();
  assert((await rowEditor.getByLabel('Intro sets').inputValue()) === '2' && (await rowEditor.getByLabel('Sets', { exact: true }).inputValue()) === '4', 'intro sets should be 2 of 4');
  await shot('20-program-3x');

  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Day 1').waitFor();
  const today = await page.locator('main').innerText();
  for (const t of ['1Back Squat', '2Bench Press', '5ALateral Raise', 'SUPERSET', '5BFace Pull', '6Calf Raise', '2 sets · intro (usually 4)', '2 sets · intro (usually 3)']) assert(today.includes(t), `missing "${t}" in Today: ${today}`);
  assert((await page.locator('li.ss-link').count()) === 1, 'Today should link the superset cards');
  const bs = await page.locator('li.card', { hasText: 'Back Squat' }).first().innerText();
  assert(bs.includes('5 reps') && !bs.includes('@'), `linear main lift must not show an RPE goal: ${bs}`);
  await shot('21-today-3x');

  await page.getByRole('button', { name: 'Start Day 1' }).click();
  await page.waitForURL(/#\/log\//);
  const lr = page.locator('li.card', { hasText: '5ALateral Raise' });
  const fp = page.locator('li.card', { hasText: '5BFace Pull' });
  await lr.waitFor();
  assert((await page.locator('li.ss-link').count()) === 1 && (await page.locator('li.card.ss-member').count()) === 2, 'the superset should be two linked cards');
  assert((await lr.locator('.set-no').allInnerTexts()).join('|') === '1|2', 'each card numbers its own sets');
  assert((await page.locator('li.card', { hasText: 'Back Squat' }).first().locator('.order-tag').innerText()) === '1', 'Back Squat should be exercise 1');
  await lr.getByLabel('Lateral Raise set 1 load').fill('15');
  await waitValue(lr.getByLabel('Lateral Raise set 2 load'), '15');
  assert((await fp.getByLabel('Face Pull set 1 load').inputValue()) === '', 'copy-down must stay inside its own exercise');
  await fp.getByLabel('Face Pull set 1 load').fill('20');
  await waitValue(fp.getByLabel('Face Pull set 2 load'), '20');
  // Enter on 5A set 1's RPE walks the superset order: 5B set 1 next (its load is filled → reps)
  await lr.getByLabel('Lateral Raise set 1 reps').fill('15');
  await lr.getByLabel('Lateral Raise set 1 RPE').focus();
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  assert((await activeLabel()) === 'Face Pull set 1 reps', `after 5A set 1, 5B set 1 should be next, got ${await activeLabel()}`);
  await page.keyboard.type('15');
  await page.keyboard.press('Enter');
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  assert((await activeLabel()) === 'Lateral Raise set 2 reps', `then 5A set 2, got ${await activeLabel()}`);
  await lr.getByLabel('Lateral Raise set 2 reps').fill('15');
  await fp.getByLabel('Face Pull set 2 reps').fill('15');
  assert((await lr.locator('.set-row.good').count()) === 2 && (await fp.locator('.set-row.good').count()) === 2, 'all four superset rows should be green');
  assert((await lr.locator('.pill').first().innerText()).includes('✓') && (await fp.locator('.pill').first().innerText()).includes('✓'), 'both cards should be done');

  const squat = page.locator('li.card', { hasText: 'Back Squat' }).first();
  assert((await squat.innerText()).includes('3 × 5') && !(await squat.innerText()).includes('@ 8'), 'linear pill should have no RPE goal');
  await squat.getByLabel('Set 1 load').fill('135');
  await waitValue(squat.getByLabel('Set 3 load'), '135');
  for (const n of [1, 2, 3]) await squat.getByLabel(`Set ${n} reps`).fill('5');
  await typeRpe(squat.getByLabel('Set 1 RPE'), '9.5');
  assert((await squat.locator('.set-row.good').count()) === 3, 'linear sets colour on reps alone, so RPE 9.5 is still green');
  await shot('22-log-3x');
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByText('Finish without these?').waitFor();
  await page.getByRole('button', { name: 'Finish anyway' }).click();
  await page.getByText('Next: Day 2').waitFor();

  await page.getByRole('link', { name: 'Program' }).click();
  await page.getByLabel('Next session').selectOption('0');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Saved', { exact: true }).first().waitFor();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Day 1').waitFor();
  const sq = await page.locator('li.card', { hasText: 'Back Squat' }).first().innerText();
  for (const t of ['140 × 5', 'Every set hit the target — add one increment', 'Warm-up sets: 85 × 5', 'Last set 1: 135 × 5 @ 9.5']) assert(sq.includes(t), `missing "${t}" in: ${sq}`);
  const lrText = await page.locator('li.card', { hasText: 'Lateral Raise' }).first().innerText();
  for (const t of ['15 × 12–20 @ 8', 'get every set to the top of the range']) assert(lrText.includes(t), `missing "${t}" in: ${lrText}`);
  const fpText = await page.locator('li.card', { hasText: 'Face Pull' }).first().innerText();
  assert(fpText.includes('20 × 12–20 @ 8'), `missing Face Pull hold in: ${fpText}`);
  await shot('23-today-3x-progressed');
});

await step('import restores the backup and the 215 suggestion', async () => {
  await importFile(backupPath);
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Day B').waitFor();
  assert((await cardText()).includes('215 × 6–8 @ 8'), await cardText());
});

await step('a legacy v1 file with startingLoad imports and is stripped', async () => {
  const legacy = JSON.parse(JSON.stringify(backupJson));
  for (const p of legacy.programs) for (const d of p.days) for (const s of d.slots) s.startingLoad = 999;
  const legacyPath = `${process.cwd()}/.smoke/legacy-v1.json`;
  fs.writeFileSync(legacyPath, JSON.stringify(legacy));
  await importFile(legacyPath);
  // re-export: the stored program must no longer carry the key
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  const reexportPath = `${process.cwd()}/.smoke/reexport.json`;
  await dl.saveAs(reexportPath);
  const again = JSON.parse(fs.readFileSync(reexportPath, 'utf8'));
  assert(again.programs.flatMap((p) => p.days.flatMap((d) => d.slots)).every((s) => !('startingLoad' in s)), 'legacy startingLoad survived import');
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Day B').waitFor();
  assert((await cardText()).includes('215 × 6–8 @ 8'), await cardText());
  await page.getByRole('link', { name: 'Program' }).click();
  await page.getByLabel('Day name').first().waitFor();
  assert((await page.getByLabel('Starting load (lb)').count()) === 0, 'starting load field reappeared');
  assert((await page.locator('section.card').nth(1).getByRole('radio', { name: 'Rep range' }).getAttribute('aria-checked')) === 'true', 'range lost on import');
});

await step('manifest and service worker are wired', async () => {
  const manifest = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'));
  assert(manifest, 'no manifest link');
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  assert(regs >= 1, 'service worker not registered');
});

await browser.close();
if (errors.length) { console.log('\nPAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nALL STEPS PASSED, no page errors');
