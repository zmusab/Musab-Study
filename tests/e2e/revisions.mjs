import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Parcours réel : créer une matière et une carte, la réviser (elle est due
 * immédiatement — une carte neuve n'a pas d'échéance future), vérifier que la
 * réponse se révèle, noter la carte, et que la séance se termine correctement.
 *
 * Prérequis : `npm run build` puis `npm run preview`.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:4173/';
const SHOT = process.env.SCREENSHOT_DIR ?? './dist-screenshots';
const results = [];
const errors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

await mkdir(SHOT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ ...devices['iPad Pro 11'] });
const page = await context.newPage();
const main = page.locator('main');
const nav = page.locator('aside, nav.fixed');
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });

// ---------- Préparer une matière et une carte ----------
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Endodontie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(500);

await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByRole('tab', { name: '✍️ Créer manuellement' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Question').fill('Quelle est la longueur de travail moyenne d’une incisive centrale ?');
await page.getByLabel('Réponse').fill('Environ 22 mm.');
await page.getByRole('button', { name: 'Ajouter la carte' }).click();
await page.waitForTimeout(600);

// ---------- Écran Révisions ----------
await nav.getByRole('link', { name: 'Révisions', exact: true }).first().click();
await page.waitForTimeout(500);
check('L’écran Révisions s’ouvre', await page.getByRole('heading', { name: 'Révisions' }).isVisible());
check('Le total des cartes dues est proposé', await page.getByText(/Commencer ma révision — 1 carte/).isVisible());

await page.getByText(/Commencer ma révision — 1 carte/).click();
await page.waitForTimeout(400);
check('La question s’affiche', await main.getByText('Quelle est la longueur de travail moyenne d’une incisive centrale ?').isVisible());
check('La réponse n’est pas visible avant révélation', !(await main.getByText('Environ 22 mm.').isVisible()));

// ---------- Rappel actif : écrire sa réponse avant de la voir ----------
check('Le champ de rappel actif est proposé', await page.locator('[data-review-attempt]').isVisible());
check('« Voir la réponse » reste disponible en secours', await page.locator('[data-review-see-answer]').isVisible());
await page.locator('[data-review-attempt]').fill('Environ 20 mm, je crois.');
await page.locator('[data-review-validate]').click();
await page.waitForTimeout(400);
check('La réponse tapée par l’étudiant est rappelée avant la bonne réponse',
  await page.locator('[data-review-your-answer]').getByText('Environ 20 mm, je crois.').isVisible());
check('La réponse attendue se révèle', await main.getByText('Environ 22 mm.').isVisible());
check('Les 4 boutons de notation sont visibles', await page.getByRole('button', { name: 'Facile' }).isVisible());

await page.getByRole('button', { name: 'Bien' }).click();
await page.waitForTimeout(500);
check('La séance se termine après la dernière carte', await page.getByText('Révision terminée').isVisible());
check('Le résumé compte la carte réussie', await page.getByText(/1\/1 carte réussie/).isVisible());

// ---------- Plus rien à réviser ----------
check('Le point d’entrée « Commencer ma révision » disparaît une fois à jour',
  !(await page.getByText(/Commencer ma révision —/).isVisible()));
check('L’état « à jour » s’affiche', await page.getByText('Tout est à jour').isVisible());

await page.screenshot({ path: `${SHOT}/ipad-revisions.png`, fullPage: false });

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
