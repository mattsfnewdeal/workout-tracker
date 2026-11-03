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
const rpe = (row, value) => setRow(row).getByRole('radio', { name: value, exact: true });

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
  await rpe(0, '7').click();
  await rpe(1, '6.5').click(); // outside 7–9 → highlighted
  await shot('04-log');
  assert((await page.locator('.set-row.outside').count()) === 1, 'expected exactly one highlighted row');
});

await step('session survives a reload and shows Resume on Today', async () => {
  await page.waitForTimeout(250); // let the write-through land before we drop the page
  await page.reload();
  await page.getByLabel('Set 1 reps').waitFor();
  assert((await page.getByLabel('Set 1 reps').inputValue()) === '5', 'reps lost');
  assert((await page.getByLabel('Set 3 load').inputValue()) === '225', 'copied-down load not persisted');
  assert((await rpe(0, '7').getAttribute('aria-checked')) === 'true', 'rpe lost');
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
  await rpe(0, '7').click();
  assert((await page.locator('.set-row.outside').count()) === 0, 'unexpected highlight');
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByText('Next: Day A').waitFor();
});

await step('pointer wrapped to Day A → 230 × 5 @ 8', async () => {
  const t = await cardText();
  for (const s of ['230 × 5 @ 8', 'All sets clean', 'Last set 1: 225 × 5 @ 7']) assert(t.includes(s), `missing "${s}" in: ${t}`);
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
  await shot('08-today-215');
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
  await page.getByRole('button', { name: 'Use preloaded program' }).click();
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
  await page.getByRole('button', { name: 'Abandon' }).first().click();
  await page.getByRole('button', { name: 'Abandon', exact: true }).last().click();
  await page.getByText('Next: Tuesday').waitFor();
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
