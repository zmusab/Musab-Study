import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Parcours du Podcast : import d'un cours, ouverture de l'écran Podcast,
 * formulaire de génération (durée, portée, enrichissement internet), et refus
 * propre sans clé API. La génération réelle nécessite un appel au modèle et
 * n'est donc pas exercée ici — voir le test manuel avec une clé pour ça.
 *
 * Prérequis : `npm run build` puis `npm run preview`.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:4173/Musab-Study/';
const SHOT = process.env.SCREENSHOT_DIR ?? './dist-screenshots';
const results = [];
const errors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const COURSE_TEXT =
  "L'émail dentaire est le tissu le plus minéralisé de l'organisme humain, composé à environ 96% d'hydroxyapatite. Il recouvre la couronne anatomique de la dent et protège la dentine sous-jacente. Contrairement à la dentine, l'émail ne contient pas de cellules vivantes une fois formé : il ne peut donc pas se régénérer naturellement en cas de lésion carieuse, ce qui explique pourquoi la prévention est essentielle. Une confusion fréquente chez les étudiants est de croire que l'émail peut cicatriser comme un os. ".repeat(4);

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

// ---------- Préparer un cours ----------
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Histologie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(500);

await main.getByRole('link', { name: /Histologie/ }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du chapitre').fill('Tissus durs');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(400);

await page.getByRole('button', { name: 'Ajouter un document' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du document').fill('Émail');
await page.getByLabel('Texte du document').fill(COURSE_TEXT);
await page.getByRole('button', { name: 'Enregistrer le document' }).click();
await page.waitForTimeout(600);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---------- Écran Podcast ----------
await nav.getByRole('link', { name: 'Podcast', exact: true }).first().click();
await page.waitForTimeout(500);
check('L’écran Podcast s’ouvre sur la matière importée',
  await page.getByRole('heading', { name: 'Podcast' }).isVisible());
check('Le formulaire de génération est visible',
  await page.getByRole('button', { name: /Transformer en podcast/ }).isVisible());

// Durées
for (const label of ['Rapide', 'Normal', 'Approfondi']) {
  check(`Le format « ${label} » est proposé`, await page.getByRole('tab', { name: label }).isVisible());
}

// Sélection "Approfondi" doit changer la description min/max affichée
await page.getByRole('tab', { name: 'Approfondi' }).click();
await page.waitForTimeout(200);
check('La durée affichée correspond au format Approfondi (30–45 min)',
  await page.getByText(/30–45 min/).isVisible());

check('L’option d’enrichissement internet est proposée',
  await page.getByText(/Enrichir avec Internet/).isVisible());

// ---------- Génération sans clé API ----------
await page.getByRole('button', { name: /Transformer en podcast/ }).click();
await page.waitForTimeout(800);
check('Sans clé API, l’échec est signalé clairement plutôt que silencieux',
  await page.getByText(/clé API dans Paramètres/).isVisible());

await page.screenshot({ path: `${SHOT}/ipad-podcast-form.png`, fullPage: false });

// ---------- Épisode introuvable ----------
await page.goto(`${BASE}#/podcast/inconnu`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('Un identifiant d’épisode invalide affiche un état clair, pas une page blanche',
  await page.getByText('Épisode introuvable').isVisible());

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
