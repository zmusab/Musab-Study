import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Reproduit précisément le bug signalé : taper lettre par lettre (pas
 * `.fill()`, qui insère le texte d'un coup et masquerait le problème) dans un
 * champ à l'intérieur d'une modale, et vérifier que le focus reste dessus
 * après chaque frappe.
 *
 * Prérequis : `npm run build` puis `npm run preview`.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:4173/';
const results = [];
const errors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ ...devices['iPad Pro 11'] });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });

const nav = page.locator('aside, nav.fixed');
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);

// ---------- Champ "Nom" de la modale "Nouvelle matière" ----------
await page.getByRole('button', { name: /matière/i }).first().click();
await page.waitForTimeout(400);

const nameInput = page.getByLabel('Nom');
await nameInput.click();
await page.keyboard.type('Anatomie', { delay: 120 });
await page.waitForTimeout(200);
check(
  'Le champ « Nom » garde le focus après une frappe lettre par lettre',
  await nameInput.evaluate((el) => el === document.activeElement),
);
check('Le texte complet a bien été saisi', (await nameInput.inputValue()) === 'Anatomie');

await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(500);

// ---------- Champ "Nom du chapitre" ----------
await page.locator('main').getByRole('link', { name: /Anatomie/ }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(400);

const chapterInput = page.getByLabel('Nom du chapitre');
await chapterInput.click();
await page.keyboard.type('Muscles', { delay: 120 });
await page.waitForTimeout(200);
check(
  'Le champ « Nom du chapitre » garde le focus après une frappe lettre par lettre',
  await chapterInput.evaluate((el) => el === document.activeElement),
);
check('Le texte complet a bien été saisi', (await chapterInput.inputValue()) === 'Muscles');

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
