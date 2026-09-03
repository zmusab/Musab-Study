import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

/**
 * Parcours réel de l'accueil à travers plusieurs états : aucune donnée,
 * cours sans révision due, cartes dues (session recommandée), reprise d'un
 * cours PDF, et retour à « à jour » après une séance terminée depuis
 * l'accueil (sans passer par le bouton « Réviser tout » de Révisions).
 *
 * Prérequis : `npm run build` puis `npm run preview`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE ?? 'http://localhost:4173/';
const SHOT = process.env.SCREENSHOT_DIR ?? './dist-screenshots';
const SAMPLE_PDF = path.join(__dirname, 'fixtures', 'sample.pdf');
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

// ---------- État 1 : aucune donnée ----------
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('État vide : invite à créer une matière', await page.getByText('Commence par créer une matière').isVisible());

// ---------- Préparer une matière, un chapitre, un document ----------
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Physiologie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(500);

await main.getByRole('link', { name: /Physiologie/ }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du chapitre').fill('Système nerveux');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Ajouter un document' }).click();
await page.waitForTimeout(300);
await page.setInputFiles('input[type="file"]', SAMPLE_PDF);
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Enregistrer le document' }).click();
await page.waitForTimeout(700);

// ---------- État 2 : cours sans carte due ----------
await nav.getByRole('link', { name: 'Accueil', exact: true }).first().click();
await page.waitForTimeout(600);
check('Accroche affichée', await page.getByText('Bonjour').isVisible());
check('Aucune carte due : message honnête plutôt qu’une file vide', await page.getByText('Aucune carte due pour l’instant').isVisible());
check('Aucun podcast en cours : invitation à en créer un', await page.getByText('Créer un podcast →').isVisible());

// ---------- Continuer mes cours : ouvrir le document une fois (depuis Cours, pas encore visité) ----------
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await main.getByRole('link', { name: /Physiologie/ }).click();
await page.waitForTimeout(400);
await main.getByRole('button', { name: /Système nerveux/ }).first().click();
await page.waitForTimeout(400);
await main.getByRole('link', { name: /sample/i }).click();
await page.waitForTimeout(1000);
await page.getByRole('link', { name: 'Retour aux cours' }).click();
await page.waitForTimeout(400);
await nav.getByRole('link', { name: 'Accueil', exact: true }).first().click();
await page.waitForTimeout(600);
check('Le document ouvert apparaît dans « Continuer à apprendre »', await page.getByText('sample').isVisible());

// ---------- État 3 : une carte due → session recommandée ----------
await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByLabel('Question').fill('Quel est le rôle du nerf vague ?');
await page.getByLabel('Réponse').fill('Il régule le système parasympathique.');
await page.getByRole('button', { name: 'Ajouter la carte' }).click();
await page.waitForTimeout(600);

await nav.getByRole('link', { name: 'Accueil', exact: true }).first().click();
await page.waitForTimeout(600);
check('La session recommandée affiche la carte due', await page.getByText('1 questions').isVisible());
check('Une durée estimée est affichée', await page.getByText(/≈ \d+ min/).isVisible());

// ---------- Commencer ma session depuis l'accueil ----------
await page.getByRole('button', { name: '▶️ Commencer ma session' }).click();
await page.waitForTimeout(600);
check('La session démarre directement, sans étape intermédiaire', await main.getByText('Quel est le rôle du nerf vague ?').isVisible());
await page.locator('[data-review-see-answer]').click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Bien' }).click();
await page.waitForTimeout(500);
check('La séance se termine', await page.getByText('Révision terminée').isVisible());

// ---------- État 5 : de retour à jour après la séance ----------
await nav.getByRole('link', { name: 'Accueil', exact: true }).first().click();
await page.waitForTimeout(600);
check('L’accueil reflète la séance terminée (plus rien de dû)', await page.getByText('Aucune carte due pour l’instant').isVisible());

// ---------- Assistant IA : sans clé API ----------
await page.getByPlaceholder('Demande quelque chose à Musab Study…').fill('Explique-moi le nerf vague');
await page.getByRole('button', { name: 'Demander', exact: true }).click();
await page.waitForTimeout(500);
check('Sans clé API, le refus est signalé au lieu de naviguer', await page.getByText('Ajoute ta clé API dans Paramètres').isVisible());
check('Reste bien sur l’accueil (pas de navigation silencieuse)', page.url().endsWith('/#/'));

await page.screenshot({ path: `${SHOT}/ipad-home.png`, fullPage: false });

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
