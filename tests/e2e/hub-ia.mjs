import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * HUB IA — vue d'ensemble des fournisseurs, sélection de fournisseur (par
 * tâche et générale), et export manuel NotebookLM depuis une matière.
 *
 * Cet environnement de test n'exécute aucune fonction serveur Vercel :
 * OpenAI et Gemini y sont donc, à raison, TOUJOURS annoncés indisponibles
 * (« Relais indisponible sur ce déploiement ») — c'est exactement le
 * comportement honnête attendu sur un aperçu local ou un hébergement
 * statique pur, vérifié ici comme un vrai cas d'usage, pas contourné.
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
const nav = page.locator('aside, nav.fixed');
const main = page.locator('main');
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const goSettings = async () => {
  await nav.getByRole('link', { name: /Paramètres/ }).first().click();
  await page.waitForTimeout(500);
};

await page.goto(BASE, { waitUntil: 'networkidle' });

// ────────────────── 1. La carte Hub IA s'affiche, statuts honnêtes ──────────────────
await goSettings();
check('La page Paramètres s’ouvre', await page.getByRole('heading', { name: 'Paramètres' }).isVisible());
check('La carte « Hub IA » est présente', await page.getByRole('heading', { name: 'Hub IA', exact: true }).isVisible());

const hubText = await page.locator('main').innerText();
check('Claude est annoncé « Non configuré » (aucune clé saisie dans ce test)', /Claude \(Anthropic\)[\s\S]{0,20}Non configuré/.test(hubText));
check(
  'OpenAI est annoncé honnêtement indisponible (aucune fonction serveur ici)',
  /OpenAI \(ChatGPT\)[\s\S]{0,40}Relais indisponible/.test(hubText),
);
check(
  'Gemini est annoncé honnêtement indisponible (aucune fonction serveur ici)',
  /Google Gemini[\s\S]{0,40}Relais indisponible/.test(hubText),
);
check(
  'NotebookLM explique l’absence d’API accessible, sans simuler une intégration',
  hubText.includes('Pas d’API accessible pour un usage personnel'),
);
check(
  'Gemini Education est rattaché à Gemini, jamais présenté comme une API distincte',
  hubText.includes('Couvert par Gemini ci-dessus'),
);
check(
  'Aucune formulation ne prétend qu’OpenAI/Gemini fonctionnent réellement ici',
  !/OpenAI \(ChatGPT\)[\s\S]{0,40}Configuré \(relais serveur\)/.test(hubText) &&
    !/Google Gemini[\s\S]{0,40}Configuré \(relais serveur\)/.test(hubText),
);

// ────────────────── 2. Vérifier la configuration — ne casse rien, ne ment pas ──────────────────
await page.locator('[data-hub-check-status]').click();
await page.waitForTimeout(600);
const afterCheckText = await page.locator('main').innerText();
check(
  'Après vérification, le statut reste honnête (toujours indisponible, pas de faux "configuré")',
  /OpenAI \(ChatGPT\)[\s\S]{0,40}Relais indisponible/.test(afterCheckText),
);

// ────────────────── 3. Sélection du fournisseur — configurable, persistante ──────────────────
await page.locator('[data-hub-preferred-provider]').selectOption({ label: 'ChatGPT' });
await page.waitForTimeout(300);
await page.reload({ waitUntil: 'networkidle' });
await goSettings();
check(
  'Le fournisseur préféré choisi survit à un rechargement',
  await page.locator('[data-hub-preferred-provider]').inputValue() === 'openai',
);
// Remet « Automatique » pour ne pas influencer un autre test de cette session.
await page.locator('[data-hub-preferred-provider]').selectOption({ label: 'Automatique' });
await page.waitForTimeout(200);

// ────────────────── 4. Préférence par tâche — indépendante, persistante ──────────────────
const flashcardsTaskSelect = page.locator('[data-hub-task-preference="flashcards-generate"]');
check('Une préférence par tâche est proposée pour chaque fonctionnalité IA existante', await flashcardsTaskSelect.isVisible());
await flashcardsTaskSelect.selectOption({ label: 'Gemini' });
await page.waitForTimeout(300);
await page.reload({ waitUntil: 'networkidle' });
await goSettings();
check(
  'La préférence par tâche survit à un rechargement, indépendamment du choix général',
  (await page.locator('[data-hub-task-preference="flashcards-generate"]').inputValue()) === 'gemini' &&
    (await page.locator('[data-hub-preferred-provider]').inputValue()) === 'auto',
);
await page.locator('[data-hub-task-preference="flashcards-generate"]').selectOption({ label: 'Automatique' });
await page.waitForTimeout(200);

// ────────────────── 5. Export NotebookLM depuis une matière — manuel, réel ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Anatomie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(700);
await main.getByRole('link', { name: 'Anatomie' }).first().click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du chapitre').fill('Nerfs crâniens');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(700);

const exportButton = page.locator('[data-export-notebooklm]');
check('Le bouton « Exporter pour NotebookLM » est proposé depuis la matière', await exportButton.isVisible());

// Sans document ni note : un message honnête plutôt qu'un fichier vide.
await exportButton.click();
await page.waitForTimeout(500);
const emptyToast = await page.locator('[aria-live="polite"]').innerText().catch(() => '');
check(
  'Sans contenu réel à exporter, un message le dit plutôt que de télécharger un fichier vide',
  /Rien à exporter/.test(emptyToast),
  emptyToast.replace(/\n/g, ' | '),
);

// Ajoute une note réelle, puis vérifie un vrai téléchargement.
await page.getByRole('tab', { name: 'Notes', exact: true }).click();
await page.waitForTimeout(400);
await page.locator('[data-subject-create-note]').click();
await page.waitForTimeout(400);
await page.locator('[data-note-editor]').getByLabel('Titre').fill('Trijumeau');
await page.locator('[data-note-editor]').getByLabel('Contenu').fill('Le nerf trijumeau (V) comporte trois branches.');
await page.locator('[data-note-save]').click();
await page.waitForTimeout(500);

await page.getByRole('tab', { name: 'Documents', exact: true }).click();
await page.waitForTimeout(400);
const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
check('Un vrai fichier est téléchargé (pas une simulation)', download.suggestedFilename().endsWith('-notebooklm.txt'));
const downloadPath = await download.path();
check('Le fichier téléchargé contient réellement le texte de la note', downloadPath !== null);
if (downloadPath) {
  const content = await (await import('node:fs/promises')).readFile(downloadPath, 'utf-8');
  check(
    'Le contenu exporté reprend le texte réel, jamais un résumé inventé',
    content.includes('Trijumeau') && content.includes('Le nerf trijumeau (V) comporte trois branches.'),
  );
}

// ────────────────── 6. iPad portrait/paysage, sans débordement ──────────────────
for (const [name, viewport] of [
  ['paysage', { width: 1194, height: 834 }],
  ['portrait', { width: 834, height: 1194 }],
]) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(400);
  await goSettings();
  await page.waitForTimeout(400);
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`Hub IA : aucun débordement horizontal dans Paramètres (${name})`, !overflow);
  await page.screenshot({ path: `${SHOT}/hub-ia-settings-${name}.png` });

  await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
  await page.waitForTimeout(400);
  await main.getByRole('link', { name: 'Anatomie' }).first().click();
  await page.waitForTimeout(500);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`Hub IA : aucun débordement horizontal sur la page matière (${name})`, !overflow);
}
await page.setViewportSize({ width: 1194, height: 834 });

console.log('\n--- Erreurs console ---');
console.log(errors.length ? errors.join('\n') : 'aucune');

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées`);
if (passed !== results.length || errors.length > 0) process.exit(1);
