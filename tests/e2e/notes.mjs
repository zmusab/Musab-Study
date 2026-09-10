import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * NOTES — créer, modifier, supprimer, rechercher, filtrer par matière et
 * chapitre, tri par date récente, intégration matière ↔ notes ↔ flashcards.
 *
 * Le principe vérifié partout : une note est réellement persistée
 * (IndexedDB), réutilisable ailleurs (matière/chapitre, recherche globale),
 * et « Créer des flashcards avec l'IA » ne peut jamais enregistrer une carte
 * sans passer par la vraie table `flashcards` (donc le vrai SM-2).
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
// La navigation contient elle aussi un lien « Anatomie » (page 3D) : on cible
// le contenu principal pour ne jamais l'ambiguïser avec la matière du même nom.
const main = page.locator('main');
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const goNotes = async () => {
  await nav.getByRole('link', { name: 'Notes', exact: true }).first().click();
  await page.waitForTimeout(600);
};

/** L'éditeur de note (modale) reste au-dessus de la page, dont les filtres
    portent les MÊMES libellés (« Matière », « Chapitre ») — sans ce scope,
    `getByLabel` trouverait deux éléments et échouerait en mode strict. */
const noteModal = page.locator('[data-note-editor]');

const dbCounts = () =>
  page.evaluate(async () => {
    const open = indexedDB.open('musab-study');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const count = (store) =>
      new Promise((resolve) => {
        const request = db.transaction(store).objectStore(store).count();
        request.onsuccess = () => resolve(request.result);
      });
    const [notes, flashcards] = await Promise.all([count('notes'), count('flashcards')]);
    db.close();
    return { notes, flashcards };
  });

await page.goto(BASE, { waitUntil: 'networkidle' });

// ────────────────── 1. État vide, honnête ──────────────────
await goNotes();
check('La page Notes s’ouvre', await page.getByRole('heading', { name: 'Notes', exact: true }).isVisible());
check(
  'Elle n’affiche jamais « en construction »',
  !(await page.getByText(/en cours de construction|Phase 10/i).count()),
);
check(
  'Sans matière, un état vide explique qu’il faut en créer une',
  await page.getByText('Les notes se rangent par matière').isVisible(),
);

// ────────────────── 2. Matières et chapitres réels ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Anatomie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Nouvelle matière' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Nom').fill('Physiologie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(700);

// Ouvre Anatomie et ajoute un chapitre, pour tester le filtre par chapitre.
await main.getByRole('link', { name: 'Anatomie' }).first().click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du chapitre').fill('Nerfs crâniens');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(700);
const anatomieUrl = page.url();
const anatomieId = anatomieUrl.split('/cours/')[1];

// ────────────────── 3. Créer une note depuis Notes ──────────────────
await goNotes();
check('Sans note, l’état vide le dit et propose d’en créer une', await page.getByText("Aucune note pour l'instant").isVisible());

await page.locator('[data-notes-create]').click();
await page.waitForTimeout(400);
await noteModal.getByLabel('Titre').fill('Nerfs crâniens — vue d’ensemble');
await noteModal.getByLabel('Matière').selectOption({ label: 'Anatomie' });
await page.waitForTimeout(200);
await noteModal.getByLabel('Chapitre').selectOption({ label: 'Nerfs crâniens' });
await noteModal.getByLabel('Contenu').fill('Douze paires de nerfs crâniens, numérotées de I à XII.');
await page.locator('[data-note-save]').click();
await page.waitForTimeout(600);

check('La note créée apparaît dans la liste', (await page.locator('[data-note-item]').count()) === 1);
const firstItemText = await page.locator('[data-note-item]').first().innerText();
check(
  'Elle affiche titre, matière et chapitre réels',
  firstItemText.includes('Nerfs crâniens — vue d’ensemble') && firstItemText.includes('Anatomie') && firstItemText.includes('Nerfs crâniens'),
  firstItemText.replace(/\n/g, ' | '),
);
check('Elle affiche sa date de modification', /modifiée/.test(firstItemText));

// ────────────────── 4. Persistance réelle ──────────────────
const afterCreate = await dbCounts();
check('La note est réellement écrite en base (IndexedDB)', afterCreate.notes === 1);
await page.reload({ waitUntil: 'networkidle' });
check('La note survit à un rechargement', (await page.locator('[data-note-item]').count()) === 1);

// ────────────────── 5. Une deuxième note, pour tri/recherche/filtres ──────────────────
await page.locator('[data-notes-create]').click();
await page.waitForTimeout(400);
await noteModal.getByLabel('Titre').fill('Physiologie rénale');
await noteModal.getByLabel('Matière').selectOption({ label: 'Physiologie' });
await noteModal.getByLabel('Contenu').fill('La filtration glomérulaire dépend de la pression capillaire.');
await page.locator('[data-note-save]').click();
await page.waitForTimeout(600);
check('La deuxième note apparaît aussi', (await page.locator('[data-note-item]').count()) === 2);

// ────────────────── 6. Tri par date récente ──────────────────
const orderedTitles = await page.locator('[data-note-item]').allInnerTexts();
check(
  'La note la plus récemment modifiée apparaît en tête',
  orderedTitles[0].includes('Physiologie rénale'),
  orderedTitles.map((t) => t.split('\n')[0]).join(' / '),
);

// ────────────────── 7. Recherche ──────────────────
await page.locator('[data-notes-search]').fill('glomérulaire');
await page.waitForTimeout(300);
check('La recherche filtre sur le contenu, pas seulement le titre', (await page.locator('[data-note-item]').count()) === 1);
await page.locator('[data-notes-search]').fill('inexistant-xyz');
await page.waitForTimeout(300);
check(
  'Une recherche sans résultat le dit honnêtement, sans liste vide silencieuse',
  await page.locator('[data-notes-empty-filtered]').isVisible(),
);
await page.locator('[data-notes-search]').fill('');
await page.waitForTimeout(300);

// ────────────────── 8. Filtre par matière ──────────────────
await page.getByLabel('Matière', { exact: true }).selectOption({ label: 'Anatomie' });
await page.waitForTimeout(300);
check(
  'Le filtre par matière n’affiche que les notes de cette matière',
  (await page.locator('[data-note-item]').count()) === 1 &&
    (await page.locator('[data-note-item]').first().innerText()).includes('Nerfs crâniens — vue d’ensemble'),
);

// ────────────────── 9. Filtre par chapitre ──────────────────
await page.getByLabel('Chapitre', { exact: true }).selectOption({ label: 'Nerfs crâniens' });
await page.waitForTimeout(300);
check('Le filtre par chapitre reste cohérent avec le filtre par matière', (await page.locator('[data-note-item]').count()) === 1);
await page.getByLabel('Matière', { exact: true }).selectOption({ label: 'Toutes les matières' });
await page.waitForTimeout(300);
check('Revenir à « toutes les matières » réaffiche tout', (await page.locator('[data-note-item]').count()) === 2);

// ────────────────── 10. Modifier une note ──────────────────
await page.locator('[data-note-open]').filter({ hasText: 'Physiologie rénale' }).click();
await page.waitForTimeout(400);
await noteModal.getByLabel('Titre').fill('Physiologie rénale — filtration');
await page.locator('[data-note-save]').click();
await page.waitForTimeout(500);
const updatedText = await page.locator('[data-note-item]').filter({ hasText: 'filtration' }).innerText();
check('Le titre modifié est bien enregistré', updatedText.includes('Physiologie rénale — filtration'));

// ────────────────── 11. Intégration matière → notes ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(500);
await main.getByRole('link', { name: 'Anatomie' }).first().click();
await page.waitForTimeout(700);
await page.getByRole('tab', { name: 'Notes', exact: true }).click();
await page.waitForTimeout(400);
check(
  'L’onglet Notes de la matière affiche la note réelle de cette matière',
  (await page.getByText('Douze paires de nerfs crâniens').count()) > 0,
);
check('Un bouton « Nouvelle note » est proposé depuis la matière', await page.locator('[data-subject-create-note]').isVisible());
check('Un lien ramène vers la page Notes complète', await page.getByRole('link', { name: 'Voir dans Notes →' }).isVisible());

// ────────────────── 12. Intégration chapitre → notes ──────────────────
await page.getByRole('tab', { name: 'Documents', exact: true }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Nerfs crâniens', exact: false }).first().click();
await page.waitForTimeout(400);
const chapterNotesLink = page.locator('[data-chapter-notes-link]');
check('Le chapitre propose un accès direct à ses notes', await chapterNotesLink.isVisible());
await chapterNotesLink.click();
await page.waitForTimeout(600);
check(
  'Ce lien ouvre Notes déjà filtrée sur la bonne matière et le bon chapitre',
  (await page.locator('[data-note-item]').count()) === 1 &&
    (await page.locator('[data-note-item]').innerText()).includes('Nerfs crâniens — vue d’ensemble'),
);

// ────────────────── 13. Note → matière associée ──────────────────
await page.locator('[data-note-subject-link]').first().click();
await page.waitForTimeout(700);
check(
  'Depuis une note, le lien matière ouvre bien la page de cette matière',
  page.url().includes(`/cours/${anatomieId}`),
);

// ────────────────── 14. « Créer des flashcards avec l’IA » — jamais sans validation ──────────────────
await goNotes();
await page.waitForTimeout(400);
const beforeAi = await dbCounts();
await page.locator('[data-note-flashcards-open]').first().click();
await page.waitForTimeout(400);
check('La modale de génération de flashcards s’ouvre', await page.locator('[data-note-flashcards]').isVisible());
await page.locator('[data-note-generate-flashcards]').click();
await page.waitForTimeout(600);
const aiToast = await page.locator('[aria-live="polite"]').innerText().catch(() => '');
/*
  Cette vérification attendait « Ajoute ta clé API ». Ce n'est plus le
  comportement, et c'est une correction : la génération depuis une note passe
  maintenant par le MÊME moteur local que la génération depuis un cours —
  aucune clé, aucun réseau.

  Ce qui compte n'a pas changé : sur une note dont rien de vérifiable ne peut
  être tiré, le moteur s'abstient ET LE DIT, au lieu d'inventer des cartes.
  C'est la garantie qu'on protège ici, pas le message d'une porte fermée.
*/
check(
  'Rien de vérifiable dans la note : le moteur s’abstient et le dit',
  /ne permet pas|aucune flashcard|pas de flashcard/i.test(aiToast),
  aiToast.replace(/\n/g, ' | '),
);
check(
  'Et il ne renvoie plus vers les Paramètres pour une clé',
  !/clé API/i.test(aiToast),
  aiToast.replace(/\n/g, ' | '),
);
const afterAi = await dbCounts();
check(
  'Aucune flashcard n’est créée sans validation explicite de l’utilisateur',
  afterAi.flashcards === beforeAi.flashcards,
  `${beforeAi.flashcards} → ${afterAi.flashcards}`,
);
await page.getByRole('button', { name: 'Fermer', exact: true }).click();
await page.waitForTimeout(400);

// ────────────────── 15. Supprimer une note, avec confirmation ──────────────────
const beforeDelete = await dbCounts();
await page.locator('[data-note-delete]').first().click();
await page.waitForTimeout(400);
check('Une confirmation est demandée avant suppression', await page.getByRole('heading', { name: 'Supprimer cette note ?' }).isVisible());
await page.getByRole('button', { name: 'Annuler', exact: true }).click();
await page.waitForTimeout(400);
const afterCancel = await dbCounts();
check('Annuler ne supprime rien', afterCancel.notes === beforeDelete.notes);

await page.locator('[data-note-delete]').first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Supprimer', exact: true }).last().click();
await page.waitForTimeout(500);
const afterDelete = await dbCounts();
check('Confirmer supprime réellement la note (base)', afterDelete.notes === beforeDelete.notes - 1);
check(
  'La liste reflète la suppression',
  (await page.locator('[data-note-item]').count()) === afterDelete.notes,
);

// ────────────────── 16. iPad portrait/paysage, sans débordement ──────────────────
for (const [name, viewport] of [
  ['paysage', { width: 1194, height: 834 }],
  ['portrait', { width: 834, height: 1194 }],
]) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(400);
  await goNotes();
  await page.waitForTimeout(400);
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`Notes : aucun débordement horizontal sur la liste (${name})`, !overflow);
  await page.screenshot({ path: `${SHOT}/notes-list-${name}.png` });

  await page.locator('[data-notes-create]').click();
  await page.waitForTimeout(500);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`Notes : aucun débordement horizontal dans l’éditeur (${name})`, !overflow);
  const modalPanel = page.locator('[role="dialog"]');
  const modalBox = await modalPanel.boundingBox();
  check(`Notes : la modale reste dans la fenêtre (${name})`, modalBox !== null && modalBox.x >= -1 && modalBox.x + modalBox.width <= viewport.width + 1);
  await page.screenshot({ path: `${SHOT}/notes-editor-${name}.png` });
  await page.locator('[data-note-cancel]').click();
  await page.waitForTimeout(300);
}
await page.setViewportSize({ width: 1194, height: 834 });

console.log('\n--- Erreurs console ---');
console.log(errors.length ? errors.join('\n') : 'aucune');

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées`);
if (passed !== results.length || errors.length > 0) process.exit(1);
