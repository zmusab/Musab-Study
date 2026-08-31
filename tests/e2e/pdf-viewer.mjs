import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

/**
 * Parcours réel : importer un vrai fichier PDF (2 pages, texte distinct par
 * page), vérifier que le fichier original est conservé et ouvrable dans le
 * lecteur intégré — pas seulement son texte extrait — avec pagination,
 * recherche dans le document, et retour vers les cours.
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

await page.goto(BASE, { waitUntil: 'networkidle' });

// ---------- Préparer une matière ----------
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Neuroanatomie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(500);

await main.getByRole('link', { name: /Neuroanatomie/ }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du chapitre').fill('Nerfs crâniens');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(500);

// ---------- Import d'un vrai PDF ----------
await page.getByRole('button', { name: 'Ajouter un document' }).click();
await page.waitForTimeout(300);
await page.setInputFiles('input[type="file"]', SAMPLE_PDF);
await page.waitForTimeout(1200);
check('Le PDF est extrait avec ses 2 pages', await page.getByText(/2 page\(s\) extraite/).isVisible());

await page.getByRole('button', { name: 'Enregistrer le document' }).click();
await page.waitForTimeout(700);
check('Le PDF original est signalé comme conservé', await page.getByText('PDF conservé et indexé pour l’IA.').isVisible());

// ---------- Le document apparaît avec sa miniature ----------
const docLink = main.getByRole('link', { name: /sample/i });
check('Le document importé apparaît dans le chapitre', await docLink.isVisible());
check('Une miniature de couverture est affichée', await docLink.locator('img').isVisible());

// ---------- Ouverture du lecteur ----------
await docLink.click();
await page.waitForTimeout(1200);
check('Le lecteur s’ouvre sur la page 1', await page.getByText(/Page 1 \/ 2/).isVisible());
check('Une page du PDF est rendue (canevas)', await page.locator('canvas').first().isVisible());

// ---------- Zoom ----------
await page.getByRole('button', { name: 'Zoom avant' }).click();
await page.waitForTimeout(400);
check('Le zoom avant reste actionnable', await page.getByRole('button', { name: 'Zoom arrière' }).isEnabled());

// ---------- Recherche dans le PDF ----------
await page.getByRole('button', { name: 'Rechercher dans ce PDF' }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder('Rechercher dans ce PDF…').fill('mandibulaire');
await page.waitForTimeout(400);
check('La recherche trouve le terme page 2', await page.getByText('Page 2', { exact: true }).isVisible());

await page.getByText('Page 2', { exact: true }).click();
await page.waitForTimeout(900);
check('Le clic sur le résultat va à la page 2', await page.getByText(/Page 2 \/ 2/).isVisible());

await page.screenshot({ path: `${SHOT}/ipad-pdf-viewer.png`, fullPage: false });

// ---------- Retour aux cours ----------
await page.getByRole('link', { name: 'Retour aux cours' }).click();
await page.waitForTimeout(500);
check('Le retour ramène à la matière', page.url().includes('/cours/'));

// ---------- Document introuvable ----------
await page.goto(`${BASE}#/document/inexistant`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('Un identifiant de document invalide affiche un état clair', await page.getByText('Document introuvable').isVisible());

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
