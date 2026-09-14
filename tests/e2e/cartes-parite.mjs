import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * PARITÉ ANKI / QUIZLET — les trois gestes qui manquaient, vérifiés de bout
 * en bout : importer un fichier de cartes, annuler la dernière note,
 * suspendre et enterrer une carte.
 *
 * Ce qui est vérifié n'est pas qu'un bouton existe, mais que le geste CHANGE
 * RÉELLEMENT ce que la session propose ensuite — donc le compteur de cartes
 * dues, qui est la seule mesure que l'étudiant lit vraiment.
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

/**
 * Nombre de cartes dues, lu sur le point d'entrée de la page Révisions.
 *
 * On passe D'ABORD par une autre page : cliquer « Révisions » alors qu'une
 * séance est déjà ouverte ne la referme pas — la page garde sa file en état,
 * et on lirait « pas de point d'entrée » au lieu du compteur. Sortir de la
 * page la démonte, donc la remet à zéro, comme le ferait l'étudiant.
 */
const dueCount = async () => {
  await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
  await page.waitForTimeout(600);
  await nav.getByRole('link', { name: 'Révisions', exact: true }).first().click();
  await page.waitForTimeout(900);
  const entry = page.getByText(/Commencer ma révision —/);
  if ((await entry.count()) === 0) return 0;
  const text = await entry.first().innerText();
  return Number(/(\d+)/.exec(text)?.[1] ?? 0);
};

const goFlashcards = async () => {
  await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
  await page.waitForTimeout(700);
};

await page.goto(BASE, { waitUntil: 'networkidle' });

// ────────────────── 1. Une matière, pour avoir où importer ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Parodontologie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(700);

// ────────────────── 2. Importer un fichier de cartes ──────────────────
// Le contenu reproduit un export d'Anki : directives en tête, tabulations,
// du HTML dans un champ, une troisième colonne d'étiquettes, et UNE ligne
// bancale qui doit être refusée en le disant.
const ankiExport = [
  '#separator:tab',
  '#html:true',
  'Qu’est-ce que le parodonte ?\tL’ensemble des tissus de soutien de la dent.\tparodonto',
  'Quels sont les quatre tissus parodontaux ?\tGencive<br>Os alvéolaire<br>Cément<br>Ligament alvéolo-dentaire\tparodonto',
  'Qu’est-ce que le sulcus ?\tLe sillon entre la gencive libre et la dent.\tparodonto',
  'Ligne sans réponse',
].join('\n');

await goFlashcards();
await page.getByRole('button', { name: 'Importer un fichier' }).click();
await page.waitForTimeout(400);
check('Le panneau d’import propose un champ de fichier', await page.locator('[data-cards-import-file]').isVisible());

await page.locator('[data-cards-import-file]').setInputFiles({
  name: 'export-anki.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(ankiExport, 'utf8'),
});
await page.waitForTimeout(700);

const previewPanel = page.locator('[data-cards-import-preview]');
check('Un aperçu s’affiche AVANT d’écrire quoi que ce soit', await previewPanel.isVisible());
const previewText = await previewPanel.innerText();
check(
  'L’aperçu annonce le séparateur réellement retenu',
  /Séparateur\s*:\s*tabulation/.test(previewText),
  previewText.split('\n').slice(0, 3).join(' | '),
);
const readCount = await page.locator('[data-cards-import-count]').getAttribute('data-cards-import-count');
check('Les trois cartes valides sont lues', readCount === '3', `${readCount} lues`);
check(
  'La ligne bancale est refusée, avec son numéro de ligne et la raison',
  /Ligne 6/.test(previewText) && /réponse manque/.test(previewText),
  previewText.replace(/\n/g, ' | ').slice(0, 200),
);
check(
  'Le HTML d’Anki est rendu lisible, pas affiché tel quel',
  !/<br>/.test(previewText) && /Gencive/.test(previewText),
);
check('Rien n’est encore enregistré : aucune carte dans la bibliothèque', (await page.locator('[data-card-toggle-suspend]').count()) === 0);

await page.locator('[data-cards-import-confirm]').click();
await page.waitForTimeout(1100);
check(
  'Les cartes importées rejoignent la bibliothèque',
  (await page.locator('[data-card-toggle-suspend]').count()) === 3,
  `${await page.locator('[data-card-toggle-suspend]').count()} cartes`,
);
// Les réponses de la bibliothèque sont éditables en place : leur texte vit
// dans la VALEUR d'un `textarea`, que `innerText` ne voit pas.
const answers = await page.locator('main textarea').evaluateAll((nodes) => nodes.map((n) => n.value));
check(
  'Le contenu importé est celui du fichier, retour à la ligne compris',
  answers.some((value) => /Gencive\nOs alvéolaire\nCément\nLigament alvéolo-dentaire/.test(value)),
  answers.join(' | ').slice(0, 160),
);
await page.screenshot({ path: `${SHOT}/cartes-import.png` });

// Réimporter le MÊME fichier ne doit pas doubler la bibliothèque.
await page.locator('[data-cards-import-file]').setInputFiles({
  name: 'export-anki.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from(ankiExport, 'utf8'),
});
await page.waitForTimeout(600);
await page.locator('[data-cards-import-confirm]').click();
await page.waitForTimeout(1100);
check(
  'Réimporter le même fichier ne crée aucun doublon',
  (await page.locator('[data-card-toggle-suspend]').count()) === 3,
  `${await page.locator('[data-card-toggle-suspend]').count()} cartes`,
);

check('Trois cartes neuves sont dues immédiatement', (await dueCount()) === 3);

// ────────────────── 3. Suspendre une carte ──────────────────
await goFlashcards();
await page.locator('[data-card-toggle-suspend]').first().click();
await page.waitForTimeout(900);
check('La carte suspendue est signalée comme telle', (await page.locator('[data-card-suspended]').count()) === 1);
check(
  'Elle reste dans la bibliothèque : rien n’est supprimé',
  (await page.locator('[data-card-toggle-suspend]').count()) === 3,
);
check('Une carte suspendue ne compte plus comme due', (await dueCount()) === 2);

// ────────────────── 4. Annuler la dernière note ──────────────────
await page.getByText(/Commencer ma révision —/).click();
await page.waitForTimeout(700);
check('Aucun bandeau d’annulation avant la première note', (await page.locator('[data-review-undo]').count()) === 0);

await page.locator('[data-review-see-answer]').click();
await page.waitForTimeout(500);
// Sans réponse écrite, le moteur ne déduit rien : les quatre notes sont là.
const before = await main.innerText();
check('La séance annonce deux cartes restantes', /0\/2/.test(before), before.split('\n')[1] ?? '');
await page.getByRole('button', { name: /^Facile/ }).click();
await page.waitForTimeout(800);
check('Le bandeau d’annulation apparaît après une note', await page.locator('[data-review-undo]').isVisible());
check('La séance est passée à la carte suivante', /1\/2/.test(await main.innerText()));

await page.locator('[data-review-undo]').click();
await page.waitForTimeout(900);
check(
  'Annuler remet le compteur de la séance où il était',
  /0\/2/.test(await main.innerText()),
  (await main.innerText()).split('\n')[1] ?? '',
);
check('Le bandeau disparaît : il n’y a plus rien à annuler', (await page.locator('[data-review-undo]').count()) === 0);
await page.screenshot({ path: `${SHOT}/cartes-annuler.png` });

// ────────────────── 5. Enterrer une carte ──────────────────
check('« Enterrer jusqu’à demain » est proposé pendant la séance', await page.locator('[data-review-bury]').isVisible());
await page.locator('[data-review-bury]').click();
await page.waitForTimeout(900);
check(
  'La carte enterrée quitte la séance sans compter comme révisée',
  /0\/2/.test(await main.innerText()),
  (await main.innerText()).split('\n')[1] ?? '',
);
const afterBury = await dueCount();
check('Une carte enterrée ne compte plus comme due aujourd’hui', afterBury === 1, `${afterBury} due(s)`);

// ────────────────── 6. Réactiver la carte suspendue ──────────────────
await goFlashcards();
await page.getByRole('button', { name: 'Réactiver' }).first().click();
await page.waitForTimeout(900);
check('La carte réactivée ne porte plus l’étiquette « Suspendue »', (await page.locator('[data-card-suspended]').count()) === 0);
check('Elle redevient due, avec son historique intact', (await dueCount()) === 2);

// ────────────────── 7. Persistance ──────────────────
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
check('L’enterrement et la réactivation survivent à un rechargement', (await dueCount()) === 2);
await goFlashcards();
check(
  'Les cartes importées sont toujours là après rechargement',
  (await page.locator('[data-card-toggle-suspend]').count()) === 3,
);

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
