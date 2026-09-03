import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Parcours réel : créer une matière/chapitre, créer une carte manuellement,
 * vérifier la maîtrise affichée, éditer par le blur, chercher, supprimer,
 * puis vérifier que la génération IA échoue proprement sans clé API.
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

// ---------- Préparer une matière ----------
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Physiologie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(500);

// ---------- Écran Flashcards ----------
await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(500);
check('L’écran Flashcards s’ouvre sur la matière importée',
  await page.getByRole('heading', { name: 'Flashcards' }).isVisible());

// ---------- Création manuelle ----------
check('Le formulaire IA est affiché par défaut, jamais les deux formulaires ensemble',
  (await page.getByLabel('Question').count()) === 0);
await page.getByRole('tab', { name: '✍️ Créer manuellement' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Question').fill('Quelle est la fréquence cardiaque normale au repos ?');
await page.getByLabel('Réponse').fill('Entre 60 et 100 battements par minute.');
await page.getByRole('button', { name: 'Ajouter la carte' }).click();
await page.waitForTimeout(600);
check('Notification de création affichée', await page.getByText('Carte ajoutée.').isVisible());
check('La carte apparaît dans la bibliothèque',
  await main.locator('input[value="Quelle est la fréquence cardiaque normale au repos ?"]').isVisible());
check('Une carte neuve, jamais révisée, l’annonce clairement plutôt qu’un trompeur « Très faible · 0% »',
  await main.getByText('À découvrir · jamais révisée').isVisible());
check('« Très faible » n’est jamais affiché pour une carte simplement neuve',
  !(await main.getByText(/Très faible/).isVisible()));

// ---------- Une seule bibliothèque, filtrable par origine ----------
check('Le filtre « Toutes / IA / Manuelles » est proposé', await page.getByRole('tab', { name: /Toutes/ }).isVisible());
await page.getByRole('tab', { name: /✍️ Manuelles/ }).click();
await page.waitForTimeout(300);
check('Le filtre « Manuelles » garde la carte créée à la main',
  await main.locator('input[value="Quelle est la fréquence cardiaque normale au repos ?"]').isVisible());
await page.getByRole('tab', { name: /✨ IA/ }).click();
await page.waitForTimeout(300);
check('Le filtre « IA » masque une carte créée à la main (elle n’est pas d’origine IA)',
  !(await main.locator('input[value="Quelle est la fréquence cardiaque normale au repos ?"]').isVisible()));
await page.getByRole('tab', { name: /Toutes/ }).click();
await page.waitForTimeout(300);
check('« Toutes » réaffiche la carte', await main.locator('input[value="Quelle est la fréquence cardiaque normale au repos ?"]').isVisible());

// ---------- Recherche ----------
await page.getByPlaceholder('Rechercher…').fill('fréquence');
await page.waitForTimeout(300);
check('La recherche filtre la bibliothèque',
  await main.locator('input[value="Quelle est la fréquence cardiaque normale au repos ?"]').isVisible());
await page.getByPlaceholder('Rechercher…').fill('inexistant-xyz');
await page.waitForTimeout(300);
check('Une recherche sans résultat affiche l’état vide',
  await page.getByText('Aucune carte').isVisible());
await page.getByPlaceholder('Rechercher…').fill('');
await page.waitForTimeout(300);

// ---------- Édition inline ----------
const editableQuestion = page.locator(
  'input[value="Quelle est la fréquence cardiaque normale au repos ?"]',
);
await editableQuestion.fill('Fréquence cardiaque au repos — adulte sain ?');
await editableQuestion.blur();
await page.waitForTimeout(500);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('La modification de la question est bien persistée après rechargement',
  await main.locator('input[value="Fréquence cardiaque au repos — adulte sain ?"]').isVisible());

// ---------- Génération IA sans clé ----------
await page.getByRole('tab', { name: '✨ Générer avec l’IA' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /Générer \d+ cartes/ }).click();
await page.waitForTimeout(900);
check('Sans clé API, l’échec de génération est signalé clairement',
  await page.getByText(/clé API dans Paramètres/).isVisible());

await page.screenshot({ path: `${SHOT}/ipad-flashcards.png`, fullPage: false });

// ---------- Suppression ----------
await page.getByRole('button', { name: 'Suppr.' }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
await page.waitForTimeout(600);
check('La carte est supprimée', await page.getByText('Carte supprimée.').isVisible());
check('La bibliothèque est vide après suppression',
  await main.getByText('Aucune carte').isVisible());

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
