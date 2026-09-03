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

// ────────────────── 1. Les réglages IA tiennent en deux choix ──────────────────
await goSettings();
check('La page Paramètres s’ouvre', await page.getByRole('heading', { name: 'Paramètres' }).isVisible());
check('Une seule carte « IA » remplace les deux cartes précédentes', await page.getByRole('heading', { name: 'IA', exact: true }).isVisible());
check('L’assistant préféré est proposé d’emblée', await page.locator('[data-hub-preferred-provider]').isVisible());
check('Le modèle est proposé d’emblée', await page.locator('[data-ai-model]').isVisible());

// Le détail technique n'est plus imposé : il vit derrière « Avancé ».
check('Les réglages par fonctionnalité ne sont plus affichés d’emblée',
  (await page.locator('[data-hub-task-preference="flashcards-generate"]').isVisible()) === false);

const hubText = await page.locator('main').innerText();
check('Claude est annoncé sans clé (aucune saisie dans ce test)', /Claude[\s\S]{0,30}Clé manquante/.test(hubText));
check('ChatGPT est annoncé honnêtement indisponible (aucune fonction serveur ici)', /ChatGPT[\s\S]{0,30}Indisponible ici/.test(hubText));
check('Gemini est annoncé honnêtement indisponible (aucune fonction serveur ici)', /Gemini[\s\S]{0,30}Indisponible ici/.test(hubText));
check('Aucune formulation ne prétend qu’ils fonctionnent réellement ici', !/ChatGPT[\s\S]{0,30}Configuré/.test(hubText));

// ────────────────── 2. Le modèle proposé dépend de l'assistant choisi ──────────────────
const modelOptions = async () => page.locator('[data-ai-model] option').allInnerTexts();
check('Par défaut, les modèles proposés sont ceux de Claude', (await modelOptions()).every((label) => /Claude/.test(label)));

await page.locator('[data-hub-preferred-provider]').selectOption({ label: 'Gemini' });
await page.waitForTimeout(300);
const geminiModels = await modelOptions();
check('Choisir Gemini propose des modèles Gemini, jamais ceux d’un autre fournisseur',
  geminiModels.length > 0 && geminiModels.every((label) => /Gemini/.test(label)), geminiModels.join(' | '));

await page.locator('[data-hub-preferred-provider]').selectOption({ label: 'ChatGPT' });
await page.waitForTimeout(300);
const openaiModels = await modelOptions();
check('Choisir ChatGPT propose des modèles OpenAI, jamais ceux d’un autre fournisseur',
  openaiModels.length > 0 && openaiModels.every((label) => /GPT/i.test(label)), openaiModels.join(' | '));

await page.reload({ waitUntil: 'networkidle' });
await goSettings();
check('L’assistant choisi survit à un rechargement', (await page.locator('[data-hub-preferred-provider]').inputValue()) === 'openai');
await page.locator('[data-hub-preferred-provider]').selectOption({ label: 'Automatique' });
await page.waitForTimeout(200);

// ────────────────── 3. Tester un fournisseur — celui-là, et lui seul ──────────────────
for (const id of ['anthropic', 'openai', 'gemini']) {
  check(`Un bouton « Tester » est proposé pour ${id}`, await page.locator(`[data-hub-test-provider="${id}"]`).isVisible());
}

await page.locator('[data-hub-test-provider="gemini"]').click();
await page.waitForTimeout(1200);
check('Tester Gemini affiche un résultat pour Gemini', await page.locator('[data-hub-test-result="gemini"]').isVisible());
check('Tester Gemini NE teste PAS Anthropic', (await page.locator('[data-hub-test-result="anthropic"]').count()) === 0);
check('Tester Gemini NE teste PAS OpenAI', (await page.locator('[data-hub-test-result="openai"]').count()) === 0);

const geminiResult = await page.locator('[data-hub-test-result="gemini"]').innerText();
check('Le résultat est lisible : réussite ou échec, en clair', /Connexion (réussie|impossible)/.test(geminiResult), geminiResult.replace(/\n/g, ' | '));
check('Sans relais ici, l’échec est annoncé honnêtement', /Connexion impossible/.test(geminiResult));

await page.locator('[data-hub-test-result="gemini"]').getByText('Détails techniques').click();
await page.waitForTimeout(200);
check('Le code d’erreur reste disponible, mais seulement sur demande',
  (await page.locator('[data-hub-test-result="gemini"]').innerText()).length > geminiResult.length);

// ────────────────── 4. Avancé — présent, mais plus imposé ──────────────────
await page.locator('[data-ai-advanced] summary').click();
await page.waitForTimeout(300);
check('« Avancé » révèle les réglages par fonctionnalité',
  await page.locator('[data-hub-task-preference="flashcards-generate"]').isVisible());
check('« Avancé » contient la clé Claude, jamais demandée pour les autres', await page.locator('[data-anthropic-key]').isVisible());
check('« Avancé » contient « Vérifier la configuration »', await page.locator('[data-hub-check-status]').isVisible());

const avance = await page.locator('[data-ai-advanced]').innerText();
check('NotebookLM explique l’absence d’API accessible, sans simuler une intégration', /NotebookLM[\s\S]{0,80}pas d’API en libre-service/.test(avance));
check('Gemini Education est rattaché à Gemini, jamais présenté comme une API distincte', /Gemini Education[\s\S]{0,80}offre de licence/.test(avance));
check('La recherche web est annoncée pour ce qu’elle est réellement', /seul Claude la pratique réellement/.test(avance));

await page.locator('[data-hub-check-status]').click();
await page.waitForTimeout(600);
check('« Vérifier la configuration » ne transforme rien en faux « configuré »',
  /ChatGPT[\s\S]{0,30}Indisponible ici/.test(await page.locator('main').innerText()));

// Un réglage par fonctionnalité reste possible, et reste VISIBLE quand il
// contredit le choix général — sinon un ancien « Gemini » s'appliquerait en
// silence après avoir choisi ChatGPT.
await page.locator('[data-hub-task-preference="flashcards-generate"]').selectOption({ label: 'Gemini' });
await page.waitForTimeout(300);
const overrideNotice = page.locator('[data-hub-task-overrides]');
check('Un réglage par fonctionnalité qui contredit le choix général est signalé', await overrideNotice.isVisible());
check('Le signalement nomme la fonctionnalité et son fournisseur',
  /Génération de flashcards\s*→\s*Gemini/.test(await overrideNotice.innerText()));

await page.locator('[data-hub-reset-task-preferences]').click();
await page.waitForTimeout(300);
check('« Tout remettre sur Automatique » efface réellement ces réglages',
  (await page.locator('[data-hub-task-preference="flashcards-generate"]').inputValue()) === 'auto' &&
    (await overrideNotice.count()) === 0);

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
