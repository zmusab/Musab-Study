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
await page.getByRole('button', { name: 'Écrire une carte moi-même' }).click();
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
check('Un verdict d’évaluation locale s’affiche avant la réponse attendue',
  await page.locator('[data-review-verdict]').isVisible());
check('La réponse attendue se révèle', await main.getByText('Environ 22 mm.').isVisible());
// La note n'est plus RÉCLAMÉE : elle est déduite de la réponse et du temps mis.
check('La note est déduite automatiquement, avec sa raison',
  await page.locator('[data-review-auto-rating]').isVisible());
check('La note déduite reste corrigeable — jamais imposée en silence',
  await page.locator('[data-review-override]').isVisible());
// « Environ 20 mm, je crois » partage « environ » et « mm » avec la réponse
// attendue : le moteur la juge INCOMPLÈTE, pas absurde, et note « Difficile ».
// La carte revient donc vite — ce qui est le comportement voulu. (Limite
// connue : sur une réponse chiffrée, le moteur ne sait pas que « 22 » est le
// cœur de la réponse et que « 20 » la rend franchement fausse.)
const autoRating = await page.locator('[data-review-auto-rating]').getAttribute('data-review-auto-rating');
check('Une réponse ratée n’est jamais notée comme une réussite', Number(autoRating) < 2, `note ${autoRating}`);

await page.locator('[data-review-next]').click();
await page.waitForTimeout(500);
check('La séance se termine après la dernière carte', await page.getByText('Révision terminée').isVisible());

/*
  CE QUE LA SÉANCE VIENT DE PRODUIRE.

  L'écran de fin s'arrêtait au score. Or le score n'est pas ce qu'on gagne en
  révisant — ce qu'on gagne, c'est que les cartes reviennent plus tard, et
  c'est le seul moment où la répétition espacée se voit fonctionner. La série
  en cours, elle, n'était affichée qu'en haut de page, jamais à l'instant où
  elle vient d'être prolongée.
*/
const returns = await page.locator('[data-review-returns]').innerText();
check(
  'La fin de séance dit quand les cartes reviennent',
  /Tu les revois/.test(returns) && /\d/.test(returns),
  returns,
);
check(
  'Le délai annoncé est une vraie échéance, pas « dans 1 j »',
  !/dans 1 j\b/.test(returns),
  returns,
);
check(
  'La série en cours est rappelée au moment où elle se prolonge',
  await page.locator('[data-review-streak]').isVisible(),
  await page.locator('[data-review-streak]').innerText(),
);
// « Environ 20 mm, je crois » face à « Environ 22 mm. » est faux : la séance
// se termine donc sur 0 réussite, ce qui est la bonne réponse pédagogique.
check('Le résumé reflète la note réellement déduite', await page.getByText(/0\/1 carte/).isVisible());

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
