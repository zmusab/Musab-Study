import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Parcours réel : créer une matière et une carte, puis vérifier que la
 * recherche globale la retrouve — y compris avec une faute de frappe
 * (« l'approximation » demandée), qu'elle groupe les résultats par type de
 * contenu, et qu'elle mène bien vers la bonne page au clic.
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
await page.getByLabel('Nom').fill('Anatomie de la tête');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(500);

await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByRole('tab', { name: '✍️ Créer manuellement' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Question').fill('Quelle est l’innervation du muscle masséter ?');
await page.getByLabel('Réponse').fill('Le nerf massétérique, branche du nerf trijumeau.');
await page.getByRole('button', { name: 'Ajouter la carte' }).click();
await page.waitForTimeout(600);

// ---------- Écran Recherche ----------
await nav.getByRole('link', { name: 'Recherche', exact: true }).first().click();
await page.waitForTimeout(500);
check('L’écran Recherche s’ouvre', await page.getByRole('heading', { name: 'Recherche' }).isVisible());

const searchInput = page.getByPlaceholder('Rechercher dans tout le site…');

check('Rien à chercher : l’invite d’usage s’affiche',
  await page.getByText('Cherche un terme, même approximatif').isVisible());

// ---------- Faute de frappe : « masster » doit quand même trouver « masséter » ----------
await searchInput.fill('masster');
await page.waitForTimeout(300);
check('La faute de frappe retrouve la carte',
  await main.getByText('Quelle est l’innervation du muscle masséter ?').isVisible());
check('Le résultat est groupé sous « Flashcard »', await main.getByText('Flashcard', { exact: true }).isVisible());

// ---------- Aucun rapport avec le contenu ----------
await searchInput.fill('radioactivité nucléaire');
await page.waitForTimeout(300);
check('Une requête sans rapport n’affiche aucun résultat',
  await page.getByText(/Aucun résultat pour/).isVisible());

// ---------- Clic mène vers Flashcards ----------
await searchInput.fill('masséter');
await page.waitForTimeout(300);
await main.getByText('Quelle est l’innervation du muscle masséter ?').click();
await page.waitForTimeout(500);
check('Le clic sur un résultat mène à la bonne page',
  page.url().includes('/flashcards'));

await page.screenshot({ path: `${SHOT}/ipad-recherche.png`, fullPage: false });

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
