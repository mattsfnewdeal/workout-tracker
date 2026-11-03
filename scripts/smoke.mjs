import { chromium } from 'playwright-core';
import fs from 'node:fs';
fs.mkdirSync('.smoke', { recursive: true });

const BASE = process.env.BASE_URL ?? 'http://localhost:4173/workout-tracker/';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const errors = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const step = async (name, fn) => { try { await fn(); console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n   ', e.message.split('\n')[0]); await page.screenshot({ path: `.smoke/FAIL-${name.replace(/\W+/g, '_')}.png` }); throw e; } };
const text = async (sel) => (await page.locator(sel).first().innerText()).trim();
const shot = (n) => page.screenshot({ path: `.smoke/${n}.png`, fullPage: true });

await step('fresh app shows empty state', async () => {
  await page.goto(BASE);
  await page.getByText('No program yet.').waitFor();
  await shot('01-today-empty');
});

await step('create a program and add Squat 3×5 @8 from 225', async () => {
  await page.getByRole('button', { name: 'Build a program' }).click();
  await page.getByRole('button', { name: 'Create a program' }).click();
  await page.getByLabel('Day name').first().waitFor();
  const dayA = page.locator('section.card').first();
  await dayA.getByPlaceholder('Exercise name').fill('Squat');
  await dayA.getByRole('button', { name: 'Add' }).click();
  await dayA.locator('strong', { hasText: 'Squat' }).waitFor();
  await dayA.getByLabel('Starting load (lb)').fill('225');
  const inc = await dayA.getByLabel('Increment (lb)').inputValue();
  if (inc !== '5') throw new Error(`increment default ${inc}`);
  await shot('02-program-editor');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Saved', { exact: true }).first().waitFor();
});

await step('Today shows first-session suggestion 225 × 5 @ 8', async () => {
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Day A').waitFor();
  const card = await text('li.card');
  if (!card.includes('225 × 5 @ 8')) throw new Error(card);
  if (!card.includes('First session')) throw new Error(card);
  await shot('03-today-first');
});

await step('start Day A and log 225×5@7, 5, 5', async () => {
  await page.getByRole('button', { name: 'Start Day A' }).click();
  await page.waitForURL(/#\/log\//);
  for (const n of [1, 2, 3]) {
    const load = await page.getByLabel(`Set ${n} load`).inputValue();
    if (load !== '225') throw new Error(`set ${n} prefilled load ${load}`);
    await page.getByLabel(`Set ${n} reps`).fill('5');
  }
  await page.locator('.set-row').nth(0).getByRole('radio', { name: '7', exact: true }).click();
  await page.locator('.set-row').nth(1).getByRole('radio', { name: '6.5', exact: true }).click(); // outside range → highlighted
  await shot('04-log');
  const outside = await page.locator('.set-row.outside').count();
  if (outside !== 1) throw new Error(`expected 1 highlighted row, got ${outside}`);
});

await step('session survives a reload and shows Resume on Today', async () => {
  await page.reload();
  await page.getByLabel('Set 1 reps').waitFor();
  const reps = await page.getByLabel('Set 1 reps').inputValue();
  if (reps !== '5') throw new Error(`reps after reload ${reps}`);
  const checked = await page.locator('.set-row').nth(0).getByRole('radio', { name: '7', exact: true }).getAttribute('aria-checked');
  if (checked !== 'true') throw new Error('rpe not restored');
  await page.goto(BASE + '#/');
  await page.getByText('Day A in progress').waitFor();
  await shot('05-today-resume');
  await page.getByRole('button', { name: 'Resume' }).click();
  await page.waitForURL(/#\/log\//);
});

await step('finish advances the pointer to Day B', async () => {
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByText('Next: Day B').waitFor();
  await page.getByText('Day B has no exercises yet.').waitFor();
});

await step('point back to Day A → engine suggests 230 × 5 @ 8 (all sets clean)', async () => {
  await page.getByRole('link', { name: 'Program' }).click();
  await page.getByLabel('Next session').selectOption('0');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Saved', { exact: true }).first().waitFor();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Day A').waitFor();
  const card = await text('li.card');
  if (!card.includes('230 × 5 @ 8')) throw new Error(card);
  if (!card.includes('All sets clean')) throw new Error(card);
  if (!card.includes('Last set 1: 225 × 5 @ 7')) throw new Error(card);
  await shot('06-today-230');
});

await step('history shows the session with e1RM 286', async () => {
  await page.getByRole('link', { name: 'History' }).click();
  await page.getByLabel('Exercise').selectOption({ label: 'Squat' });
  await page.getByText('e1RM from set 1: 286').waitFor();
  await shot('07-history');
});

let backupPath;
await step('export backup via download fallback and record last backup', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByText('Last backup: never').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  backupPath = `${process.cwd()}/.smoke/${download.suggestedFilename()}`;
  await download.saveAs(backupPath);
  const json = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  if (json.app !== 'workout-tracker' || json.setLogs.length !== 3) throw new Error(JSON.stringify(Object.keys(json)));
  await page.getByText('Backup exported').waitFor();
  const last = await text('main p:has-text("Last backup")');
  if (last.includes('never')) throw new Error(last);
  await shot('08-settings');
});

await step('reset wipes everything', async () => {
  await page.getByRole('button', { name: 'Reset all data' }).click();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.getByText('All data deleted').waitFor();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('No program yet.').waitFor();
});

await step('import restores the backup and the 230 suggestion', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.locator('input[type=file]').setInputFiles(backupPath);
  await page.getByText('Replace everything?').waitFor();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByText('Backup imported').waitFor();
  await page.getByRole('link', { name: 'Today' }).click();
  await page.getByText('Next: Day A').waitFor();
  const card = await text('li.card');
  if (!card.includes('230 × 5 @ 8')) throw new Error(card);
});

await step('manifest and service worker are wired', async () => {
  const manifest = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'));
  if (!manifest) throw new Error('no manifest link');
  const regs = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  if (regs < 1) throw new Error('service worker not registered');
});

await browser.close();
if (errors.length) { console.log('\nPAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log('\nALL STEPS PASSED, no page errors');
