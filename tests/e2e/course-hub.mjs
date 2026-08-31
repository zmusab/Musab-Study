import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

/**
 * Parcours du centre documentaire Cours : import → onglets de la page de
 * matière → note prise dans le lecteur, retrouvée dans l'onglet Notes et
 * ramenant à la bonne page → analyse d'un chapitre (échec honnête sans clé
 * API, pas de simulation) → renommer un chapitre → déplacer un document →
 * recherche depuis la page Cours → bouton plein écran → persistance après
 * rechargement.
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

// ---------- Matière, deux chapitres, un document ----------
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Anatomie céphalique');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(500);

await main.getByRole('link', { name: /Anatomie céphalique/ }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du chapitre').fill('Muscles masticateurs');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du chapitre').fill('Ostéologie');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(500);

// Le premier chapitre créé (« Muscles masticateurs ») reçoit le document.
await page.getByRole('button', { name: /Muscles masticateurs/ }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Ajouter un document' }).first().click();
await page.waitForTimeout(300);
await page.setInputFiles('input[type="file"]', SAMPLE_PDF);
await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Enregistrer le document' }).click();
await page.waitForTimeout(1000);

// ---------- Onglets de la page de matière ----------
check('Onglet Documents actif par défaut', await page.getByRole('tab', { name: 'Documents' }).getAttribute('aria-selected') === 'true');
check('Taille du fichier affichée', await page.getByText(/\d+ (o|Ko|Mo)\b/).isVisible());

// ---------- Note prise dans le lecteur ----------
const docLink = main.getByRole('link', { name: /sample/i });
await docLink.click();
await page.waitForTimeout(1000);
check('Le lecteur s’ouvre sur la page 1', await page.getByText(/Page 1 \/ 2/).isVisible());

await page.getByRole('button', { name: 'Mes notes' }).click();
await page.waitForTimeout(300);
await page.getByPlaceholder(/Ajouter une note sur la page/).fill('Le masséter élève la mandibule.');
await page.getByRole('button', { name: 'Ajouter une note' }).click();
await page.waitForTimeout(400);
check('La note ajoutée apparaît dans le panneau', await page.getByText('Le masséter élève la mandibule.').isVisible());

// ---------- Plein écran (dégradation silencieuse si indisponible) ----------
const fullscreenButton = page.getByRole('button', { name: /plein écran/i });
if (await fullscreenButton.isVisible().catch(() => false)) {
  await fullscreenButton.click();
  await page.waitForTimeout(300);
  check('Le bouton plein écran ne casse rien', errors.length === 0);
} else {
  check('Pas de bouton plein écran quand l’API est indisponible (pas de faux bouton)', true);
}

await page.getByRole('link', { name: 'Retour aux cours' }).click();
await page.waitForTimeout(600);

// ---------- Onglet Notes ----------
await page.getByRole('tab', { name: 'Notes' }).click();
await page.waitForTimeout(300);
check('La note prise dans le lecteur apparaît dans l’onglet Notes', await page.getByText('Le masséter élève la mandibule.').isVisible());

await page.getByText('Le masséter élève la mandibule.').click();
await page.waitForTimeout(900);
check('Cliquer la note ramène exactement à sa page d’origine', await page.getByText(/Page 1 \/ 2/).isVisible());

await page.getByRole('link', { name: 'Retour aux cours' }).click();
await page.waitForTimeout(600);

// ---------- Onglet Notions — échec honnête sans clé API, pas de simulation ----------
await page.getByRole('tab', { name: 'Notions' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Analyser ce chapitre' }).first().click();
await page.waitForTimeout(400);
check('Sans clé API, l’analyse échoue clairement plutôt que d’inventer des notions',
  await page.getByText(/clé API dans Paramètres/).isVisible());

// ---------- Renommer un chapitre ----------
await page.getByRole('tab', { name: 'Documents' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Renommer « Ostéologie »' }).click();
await page.waitForTimeout(300);
await page.getByRole('dialog').getByLabel('Nom', { exact: true }).fill('Ostéologie du crâne');
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(500);
check('Le chapitre renommé apparaît sous son nouveau nom', await page.getByRole('heading', { name: 'Ostéologie du crâne' }).isVisible());

// ---------- Déplacer le document vers l’autre chapitre ----------
await page.getByRole('button', { name: /Muscles masticateurs/ }).first().click();
await page.waitForTimeout(600);
await page.getByLabel(/Déplacer « sample/i).selectOption({ label: 'Ostéologie du crâne' });
await page.waitForTimeout(500);
check('Le document déplacé quitte son chapitre d’origine', !(await docLink.isVisible().catch(() => false)));

await page.getByRole('button', { name: /Ostéologie du crâne/ }).first().click();
await page.waitForTimeout(600);
check('Le document déplacé apparaît dans le nouveau chapitre', await main.getByRole('link', { name: /sample/i }).isVisible());

// ---------- Recherche depuis la page Cours ----------
await page.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByPlaceholder('Rechercher dans mes cours…').fill('masséter');
await page.keyboard.press('Enter');
await page.waitForTimeout(700);
check('La recherche lancée depuis Cours ouvre la page Recherche avec la requête pré-remplie', page.url().includes('/recherche'));
check('Le résultat de la note apparaît', await page.getByText('Le masséter élève la mandibule.').isVisible());

// ---------- Persistance après rechargement ----------
await page.goto(BASE, { waitUntil: 'networkidle' });
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await main.getByRole('link', { name: /Anatomie céphalique/ }).click();
await page.waitForTimeout(400);
await page.getByRole('tab', { name: 'Notes' }).click();
await page.waitForTimeout(300);
check('La note persiste après rechargement', await page.getByText('Le masséter élève la mandibule.').isVisible());
await page.getByRole('tab', { name: 'Documents' }).click();
await page.waitForTimeout(300);
check('Le renommage du chapitre persiste après rechargement', await page.getByText('Ostéologie du crâne').isVisible());

await page.screenshot({ path: `${SHOT}/ipad-course-hub.png`, fullPage: false });

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
