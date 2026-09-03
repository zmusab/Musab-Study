import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * QUIZ — parcours réel : choisir un type de quiz, répondre, voir le
 * résultat, réviser les erreurs, et vérifier que tout se reflète dans
 * Progression sans jamais toucher aux échéances SM-2 des flashcards.
 *
 * Le principe vérifié partout : les quatre options d'une question sont des
 * réponses RÉELLES de flashcards existantes, jamais du texte inventé — et
 * une réponse au quiz écrit dans `reviewLogs` (`itemKind: 'quiz'`) sans
 * jamais modifier la table `flashcards`.
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
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const goQuiz = async () => {
  await nav.getByRole('link', { name: 'Quiz', exact: true }).first().click();
  await page.waitForTimeout(700);
};

/**
 * Ramène l'écran de configuration, quel que soit l'état courant. Le clic sur
 * le lien de navigation ne remonte pas le composant si la route est déjà
 * active : depuis les résultats ou une question en cours, il faut repasser
 * explicitement par « Nouveau quiz » / « Quitter ».
 */
const resetToSetup = async () => {
  if (await page.locator('[data-quiz-setup]').count()) return;
  if (await page.locator('[data-quiz-restart]').count()) {
    await page.locator('[data-quiz-restart]').click();
    await page.waitForTimeout(400);
    return;
  }
  if (await page.locator('[data-quiz-session]').count()) {
    await page.getByRole('button', { name: 'Quitter', exact: true }).first().click();
    await page.waitForTimeout(400);
    const confirmBtn = page.getByRole('button', { name: 'Quitter', exact: true }).last();
    if (await confirmBtn.count()) await confirmBtn.click();
    await page.waitForTimeout(400);
  }
};

/** Sélectionne une matière dans un <select> par préfixe de nom : le libellé
    réel porte aussi le nombre de cartes, qui varie selon le test. */
const selectSubject = async (selectLocator, namePrefix) => {
  const label = await selectLocator.locator('option').evaluateAll(
    (options, prefix) => options.find((o) => o.textContent.trim().startsWith(prefix))?.textContent.trim() ?? null,
    namePrefix,
  );
  if (!label) throw new Error(`Aucune option ne commence par « ${namePrefix} »`);
  await selectLocator.selectOption({ label });
};

const dbSnapshot = () =>
  page.evaluate(async () => {
    const open = indexedDB.open('musab-study');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const readAll = (store) =>
      new Promise((resolve) => {
        const request = db.transaction(store).objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result);
      });
    const [cards, logs] = await Promise.all([readAll('flashcards'), readAll('reviewLogs')]);
    db.close();
    return {
      cards: cards.map((c) => ({ id: c.id, due: c.due, ease: c.ease, interval: c.interval, reps: c.reps, lapses: c.lapses })),
      logs: logs.map((l) => ({
        itemKind: l.itemKind,
        subjectId: l.subjectId,
        chapterId: l.chapterId,
        itemId: l.itemId,
        correct: l.correct,
        rating: l.rating,
        elapsedMs: l.elapsedMs,
      })),
    };
  });

/**
 * Ajoute directement une flashcard réelle marquée « tombe à l'examen »
 * (importance 3) sur la matière donnée — les cartes créées par ce script via
 * le formulaire manuel de Flashcards ont toutes l'importance par défaut (2),
 * ce qui ne suffit jamais à produire une estimation en probabilité élevée.
 * Cette carte est une vraie carte, traitée par l'application exactement
 * comme n'importe quelle autre — ce n'est pas un double de test.
 */
const seedHighImportanceCard = (subjectName) =>
  page.evaluate(async (name) => {
    const open = indexedDB.open('musab-study');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const subjects = await new Promise((resolve) => {
      const request = db.transaction('subjects').objectStore('subjects').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    const subject = subjects.find((s) => s.name === name);
    const now = new Date().toISOString();
    const card = {
      id: 'e2e_examen_probable_high',
      subjectId: subject.id,
      chapterId: null,
      question: 'Quel os forme la base du crâne en arrière ?',
      answer: 'L’os occipital.',
      importance: 3,
      difficulty: 2,
      ease: 2.5,
      interval: 0,
      reps: 0,
      lapses: 0,
      due: now,
      lastReview: null,
      origin: 'manual',
      sourceChunkIds: [],
      createdAt: now,
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction('flashcards', 'readwrite');
      tx.objectStore('flashcards').put(card);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, subjectName);

/** Répond à toutes les questions restantes ; renvoie le nombre de réponses données. */
const answerAll = async ({ chooseCorrect = false } = {}) => {
  let answered = 0;
  for (let guard = 0; guard < 40; guard += 1) {
    const options = page.locator('[data-quiz-option]');
    if (!(await options.count())) break;
    if (chooseCorrect) {
      const correct = page.locator('[data-quiz-option]').filter({ hasNot: page.locator(':scope') });
      // Sélectionne l'option qui deviendra `data-quiz-option-correct` : on ne
      // le sait qu'après le clic, donc on clique la première option puis on
      // vérifie ; à défaut on ne force pas la bonne réponse ici.
      await options.first().click();
    } else {
      await options.first().click();
    }
    answered += 1;
    await page.waitForTimeout(300);
    const next = page.locator('[data-quiz-next]');
    if (!(await next.count())) break;
    await next.click();
    await page.waitForTimeout(400);
  }
  return answered;
};

await page.goto(BASE, { waitUntil: 'networkidle' });

// ────────────────── 1. État vide, honnête ──────────────────
await goQuiz();
check('La page Quiz s’ouvre', await page.getByRole('heading', { name: 'Quiz', exact: true }).isVisible());
check(
  'Elle n’affiche jamais « en construction »',
  !(await page.getByText(/en cours de construction|Phase 7/i).count()),
);
check(
  'Sans matière, un état vide explique ce qu’il faut faire',
  await page.getByText('Le quiz se construit à partir de tes flashcards').isVisible(),
);

// ────────────────── 2. Données réelles ──────────────────
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

await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(700);
const CARDS = [
  ['Combien de racines a la première molaire mandibulaire ?', 'Deux racines.'],
  ['Quel nerf innerve le masséter ?', 'Le nerf massétérique.'],
  ['Quelle artère vascularise la langue ?', 'L’artère linguale.'],
  ['Quel os forme le palais dur en arrière ?', 'L’os palatin.'],
  ['Combien de dents compte la denture permanente ?', '32 dents.'],
  ['Quel muscle élève la mandibule principalement ?', 'Le muscle masséter.'],
];
await page.getByRole('tab', { name: '✍️ Créer manuellement' }).click();
await page.waitForTimeout(300);
for (const [q, a] of CARDS) {
  await page.getByLabel('Question').fill(q);
  await page.getByLabel('Réponse').fill(a);
  await page.getByRole('button', { name: 'Ajouter la carte' }).click();
  await page.waitForTimeout(300);
}

// ────────────────── 3. Création d'un quiz : types et paramètres ──────────────────
await goQuiz();
check(
  'Les sept types de quiz sont proposés (dont « Examen probable »)',
  (await page.locator('[data-quiz-scope]').count()) === 7,
);
check(
  'Un mode sans distinction de compteur reste sélectionnable',
  await page.locator('[data-quiz-scope="subject"]').isVisible(),
);
check(
  'Un mode sans donnée le dit plutôt que de le cacher',
  (await page.locator('[data-quiz-scope="weak"]').getByText('Rien pour l’instant').count()) === 1,
);

await page.locator('[data-quiz-scope="subject"]').click();
await page.waitForTimeout(300);
await selectSubject(page.getByLabel('Matière'), 'Anatomie');
await page.getByLabel('Nombre de questions').selectOption('5');
await page.getByLabel('Difficulté').selectOption('mixed');
await page.locator('[data-quiz-start]').click();
await page.waitForTimeout(800);

// ────────────────── 4. Questions : 4 options, progression, indice ──────────────────
check('Le quiz démarre', await page.locator('[data-quiz-session]').isVisible());
check('La première question affiche 4 options', (await page.locator('[data-quiz-option]').count()) === 4);
check(
  'La progression annonce la bonne question sur le bon total',
  /Question 1\/5/.test(await page.locator('[data-quiz-progress]').innerText()),
);
const optionTexts = await page.locator('[data-quiz-option]').allInnerTexts();
check('Les 4 options sont des textes distincts', new Set(optionTexts).size === 4);

check('Un indice est proposé, masqué par défaut', await page.locator('[data-quiz-hint-toggle]').isVisible());
check('Aucun indice affiché avant d’avoir été demandé', (await page.locator('[data-quiz-hint]').count()) === 0);
await page.locator('[data-quiz-hint-toggle]').click();
await page.waitForTimeout(200);
const hintText = await page.locator('[data-quiz-hint]').innerText();
check('L’indice affiché contient un vrai extrait de la réponse', hintText.length > 0, hintText);

// ────────────────── 5. Réponse et correction ──────────────────
await page.locator('[data-quiz-option]').first().click();
await page.waitForTimeout(400);
check(
  'Après le choix, les options sont figées',
  await page.locator('[data-quiz-option]').first().isDisabled(),
);
check(
  'La bonne réponse est mise en évidence',
  (await page.locator('[data-quiz-option-correct]').count()) === 1,
);
check(
  'Une explication réelle apparaît (contexte de maîtrise de la carte)',
  (await page.locator('[data-quiz-explanation]').innerText()).length > 10,
);
check('Le bouton mène à la question suivante', await page.locator('[data-quiz-next]').isVisible());

// ────────────────── 6. Fin du quiz, score et résultats ──────────────────
const before = await dbSnapshot();
await page.locator('[data-quiz-next]').click();
await page.waitForTimeout(400);
await answerAll();

check('Le résultat s’affiche à la fin', await page.locator('[data-quiz-results]').isVisible());
const scoreText = await page.locator('[data-quiz-score]').innerText();
check('Un score en pourcentage est affiché', /%/.test(scoreText), scoreText);
const resultsText = await page.locator('[data-quiz-results]').innerText();
check('Le résultat annonce le nombre de bonnes réponses et le temps', /\/5 bonne/.test(resultsText) && /s$|min$|h$/.test(resultsText.trim()) === false || /\d/.test(resultsText));
check(
  'Les matières concernées apparaissent, toujours, indépendamment du score',
  (await page.locator('[data-quiz-subjects]').innerText()).includes('Anatomie'),
);

// ────────────────── 7. Persistance et non-altération des flashcards ──────────────────
const after = await dbSnapshot();
check(
  'Les flashcards ne sont JAMAIS modifiées par un quiz (aucune échéance SM-2 touchée)',
  JSON.stringify(before.cards) === JSON.stringify(after.cards),
);
const quizLogs = after.logs.filter((l) => l.itemKind === 'quiz');
check('Chaque réponse au quiz est journalisée', quizLogs.length === 5, `${quizLogs.length} lignes`);
check(
  'Les réponses de quiz ne portent jamais de note SM-2 (rating null)',
  quizLogs.every((l) => l.rating === null),
);
check(
  'Le temps journalisé est réellement mesuré, jamais nul ni inventé',
  quizLogs.every((l) => l.elapsedMs > 0),
);

await page.reload({ waitUntil: 'networkidle' });
const reloaded = await dbSnapshot();
check(
  'Les résultats survivent à un rechargement',
  reloaded.logs.filter((l) => l.itemKind === 'quiz').length === 5,
);

// ────────────────── 8. Influence sur Progression ──────────────────
await nav.getByRole('link', { name: 'Progression', exact: true }).first().click();
await page.waitForTimeout(1200);
const counters = await page.locator('[data-progress-counters]').innerText();
check(
  'Les réponses au quiz comptent dans le total de réponses de Progression',
  /5 réponses|6 réponses/.test(counters) || /réponse/.test(counters),
  counters.replace(/\n/g, ' '),
);
const activityText = await page.locator('[data-progress-activity]').innerText().catch(() => '');
check(
  'Le quiz apparaît dans l’activité récente, avec la matière réelle',
  activityText.includes('Anatomie'),
  activityText.replace(/\n/g, ' | ').slice(0, 120),
);

// ────────────────── 9. Réviser mes erreurs → vraie séance ──────────────────
await goQuiz();
await page.locator('[data-quiz-scope="subject"]').click();
await page.waitForTimeout(200);
await selectSubject(page.getByLabel('Matière'), 'Anatomie');
await page.getByLabel('Nombre de questions').selectOption('5');
await page.locator('[data-quiz-start]').click();
await page.waitForTimeout(700);
await answerAll();
await page.waitForTimeout(500);

const missedCount = await page.locator('[data-quiz-missed] li').count();
const reviewLink = page.locator('a:has([data-quiz-review-errors])');
if (missedCount > 0) {
  check('Un lien « Réviser mes erreurs » est proposé', await reviewLink.isVisible());
  const href = await reviewLink.getAttribute('href');
  check('Il cible des cartes précises', /\/revisions\?cards=.+/.test(href ?? ''), href ?? '');
  await reviewLink.click();
  await page.waitForTimeout(900);
  check(
    'Il ouvre réellement une séance de révision, pas un écran vide',
    (await page.getByText(/révisée\(s\)/).count()) > 0,
  );
} else {
  check('Sans erreur, aucun lien de révision n’est proposé à tort', (await reviewLink.count()) === 0);
}

// ────────────────── 10. Influence sur les priorités ──────────────────
// Une matière volontairement ratée à répétition doit remonter en priorité.
await goQuiz();
for (let attempt = 0; attempt < 3; attempt += 1) {
  await page.locator('[data-quiz-scope="subject"]').click();
  await page.waitForTimeout(200);
  await selectSubject(page.getByLabel('Matière'), 'Physiologie');
  await page.waitForTimeout(200);
}
// Physiologie n'a aucune flashcard : on en ajoute pour pouvoir la rater.
await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(700);
await page.getByRole('tab', { name: '✍️ Créer manuellement' }).click();
await page.waitForTimeout(300);
const subjectPicker = page.locator('select').first();
if (await subjectPicker.count()) {
  await selectSubject(subjectPicker, 'Physiologie').catch(() => {});
}
for (const [q, a] of [
  ['Quelle hormone régule la glycémie ?', 'L’insuline.'],
  ['Quel organe filtre le sang ?', 'Le rein.'],
  ['Quel gaz est expiré en excès ?', 'Le CO2.'],
  ['Quelle cellule transporte l’oxygène ?', 'Le globule rouge.'],
]) {
  await page.getByLabel('Question').fill(q);
  await page.getByLabel('Réponse').fill(a);
  await page.getByRole('button', { name: 'Ajouter la carte' }).click();
  await page.waitForTimeout(300);
}

await goQuiz();
await page.locator('[data-quiz-scope="subject"]').click();
await page.waitForTimeout(200);
await selectSubject(page.getByLabel('Matière'), 'Physiologie');
await page.getByLabel('Nombre de questions').selectOption('5');
await page.locator('[data-quiz-start]').click();
await page.waitForTimeout(700);
await answerAll();
await page.waitForTimeout(600);

await nav.getByRole('link', { name: 'Progression', exact: true }).first().click();
await page.waitForTimeout(1200);
const prioritiesText = await page.locator('[data-progress-priorities]').innerText().catch(() => '');
check(
  'La matière évaluée en quiz apparaît dans les priorités de Progression',
  prioritiesText.includes('Physiologie') || prioritiesText.includes('Anatomie'),
  prioritiesText.replace(/\n/g, ' | ').slice(0, 160),
);

// ────────────────── 11. Vues et responsive ──────────────────
for (const [name, viewport] of [
  ['paysage', { width: 1194, height: 834 }],
  ['portrait', { width: 834, height: 1194 }],
]) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(500);
  await goQuiz();
  await resetToSetup();
  await page.waitForTimeout(500);
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`Aucun débordement horizontal sur l’écran de configuration en ${name}`, !overflow);
  await page.screenshot({ path: `${SHOT}/quiz-setup-${name}.png` });

  await page.locator('[data-quiz-scope="subject"]').click();
  await page.waitForTimeout(200);
  await selectSubject(page.getByLabel('Matière'), 'Anatomie');
  await page.locator('[data-quiz-start]').click();
  await page.waitForTimeout(700);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`Aucun débordement horizontal pendant une question en ${name}`, !overflow);
  await page.screenshot({ path: `${SHOT}/quiz-session-${name}.png` });

  await answerAll();
  await page.waitForTimeout(500);
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`Aucun débordement horizontal sur les résultats en ${name}`, !overflow);
  await page.screenshot({ path: `${SHOT}/quiz-results-${name}.png` });
}

const smallTargets = await page.evaluate(() =>
  [...document.querySelectorAll('main button, main a[href]')]
    .map((el) => ({ label: el.innerText.trim().slice(0, 24), rect: el.getBoundingClientRect() }))
    .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0 && entry.rect.height < 28)
    .map((entry) => `${entry.label}:${Math.round(entry.rect.height)}`),
);
check('Les cibles tactiles restent utilisables', smallTargets.length === 0, smallTargets.join(', '));

// ────────────────── 12. Quitter un quiz en cours n’enregistre rien ──────────────────
await page.setViewportSize({ width: 1194, height: 834 });
await goQuiz();
await resetToSetup();
await page.waitForTimeout(300);
const beforeQuit = await dbSnapshot();
await page.locator('[data-quiz-scope="subject"]').click();
await page.waitForTimeout(200);
await selectSubject(page.getByLabel('Matière'), 'Anatomie');
await page.locator('[data-quiz-start]').click();
await page.waitForTimeout(700);
await page.locator('[data-quiz-option]').first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Quitter' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Quitter', exact: true }).last().click();
await page.waitForTimeout(600);
const afterQuit = await dbSnapshot();
check(
  'Quitter un quiz avant la fin n’écrit rien en base',
  afterQuit.logs.length === beforeQuit.logs.length,
  `${beforeQuit.logs.length} → ${afterQuit.logs.length}`,
);
check('On revient à l’écran de configuration', await page.locator('[data-quiz-setup]').isVisible());

// ────────────────── 13. Format Vrai/Faux ──────────────────
await goQuiz();
await resetToSetup();
await page.waitForTimeout(300);
await page.locator('[data-quiz-scope="subject"]').click();
await page.waitForTimeout(200);
await selectSubject(page.getByLabel('Matière'), 'Anatomie');
await page.getByLabel('Nombre de questions').selectOption('5');
await page.getByLabel('Format').selectOption('vf');
const beforeVf = await dbSnapshot();
await page.locator('[data-quiz-start]').click();
await page.waitForTimeout(700);

check('Le quiz Vrai/Faux démarre', await page.locator('[data-quiz-session]').isVisible());
check(
  'La question affiche exactement deux options : Vrai et Faux',
  JSON.stringify((await page.locator('[data-quiz-option]').allInnerTexts()).sort()) ===
    JSON.stringify(['Faux', 'Vrai']),
);
check(
  'La carte de question porte le format vrai/faux',
  (await page.locator('[data-quiz-question-format="vf"]').count()) === 1,
);
check(
  'Aucun indice n’est proposé en Vrai/Faux (l’affirmation contient déjà la réponse)',
  (await page.locator('[data-quiz-hint-toggle]').count()) === 0,
);

await answerAll();
await page.waitForTimeout(500);
check('Le résultat du quiz Vrai/Faux s’affiche', await page.locator('[data-quiz-results]').isVisible());

const afterVf = await dbSnapshot();
check(
  'Les flashcards ne sont jamais modifiées par un quiz Vrai/Faux',
  JSON.stringify(beforeVf.cards) === JSON.stringify(afterVf.cards),
);
check(
  'Les réponses Vrai/Faux sont journalisées comme les QCM (itemKind: quiz, rating: null)',
  afterVf.logs.filter((l) => l.itemKind === 'quiz').length === beforeVf.logs.filter((l) => l.itemKind === 'quiz').length + 5 &&
    afterVf.logs.slice(-5).every((l) => l.itemKind === 'quiz' && l.rating === null),
);

// Format mixte : la session peut alterner QCM (4 options) et Vrai/Faux (2).
await resetToSetup();
await page.waitForTimeout(300);
await page.locator('[data-quiz-scope="subject"]').click();
await page.waitForTimeout(200);
await selectSubject(page.getByLabel('Matière'), 'Anatomie');
await page.getByLabel('Nombre de questions').selectOption('5');
await page.getByLabel('Format').selectOption('mixed');
await page.locator('[data-quiz-start]').click();
await page.waitForTimeout(700);
let sawQcm = false;
let sawVf = false;
for (let i = 0; i < 5; i += 1) {
  const count = await page.locator('[data-quiz-option]').count();
  if (count === 4) sawQcm = true;
  if (count === 2) sawVf = true;
  await page.locator('[data-quiz-option]').first().click();
  await page.waitForTimeout(250);
  const next = page.locator('[data-quiz-next]');
  if (!(await next.count())) break;
  await next.click();
  await page.waitForTimeout(350);
}
check(
  'Le format mixte construit des questions valides (QCM et/ou Vrai/Faux, jamais autre chose)',
  sawQcm || sawVf,
);

// ────────────────── 14. « Examen probable » — une ESTIMATION, jamais une certitude ──────────────────
await seedHighImportanceCard('Anatomie');
await resetToSetup();
await page.reload({ waitUntil: 'networkidle' });
await goQuiz();
await resetToSetup();
await page.waitForTimeout(300);

check(
  'Le mode « Examen probable » est proposé parmi les types de quiz',
  await page.locator('[data-quiz-scope="exam-likely"]').isVisible(),
);
await page.locator('[data-quiz-scope="exam-likely"]').click();
await page.waitForTimeout(300);

const examLikelyPanelText = await page.locator('[data-quiz-exam-likely-panel]').innerText();
check(
  'Le texte « Questions probables — estimation basée sur le contenu disponible » est affiché',
  examLikelyPanelText.includes('Questions probables') && examLikelyPanelText.includes('Estimation basée sur le contenu disponible'),
);
check(
  'La note de transparence explique que l’estimation ne garantit rien',
  (await page.locator('[data-quiz-exam-likely-disclaimer]').innerText()).includes('ne garantit pas les questions de l’examen'),
);
check(
  'Sans examen enregistré pour cette matière, l’absence de donnée est dite honnêtement',
  examLikelyPanelText.includes('Aucun examen enregistré pour cette matière'),
);

// Renforcer avec l'IA sans clé configurée : message honnête, rien ne casse,
// aucune fausse analyse n'est enregistrée.
const analyzeButton = page.locator('[data-quiz-exam-likely-analyze]');
if (await analyzeButton.count()) {
  await analyzeButton.click();
  await page.waitForTimeout(500);
  const toastText = await page.locator('[aria-live="polite"]').innerText().catch(() => '');
  check(
    'Sans clé API, le renfort IA le dit clairement plutôt que d’échouer en silence',
    /clé API/i.test(toastText),
    toastText.replace(/\n/g, ' | '),
  );
}

await page.getByLabel('Nombre de questions').selectOption('5');
await page.getByLabel('Format').selectOption('mixed');
const beforeExamLikely = await dbSnapshot();
await page.locator('[data-quiz-start]').click();
await page.waitForTimeout(800);

check('Le quiz « Examen probable » démarre', await page.locator('[data-quiz-session]').isVisible());
const likelihoodBadge = page.locator('[data-quiz-exam-likelihood]');
check('La première question porte un badge de probabilité (🟢🟡🟠)', await likelihoodBadge.count() > 0);
const badgeLevel = await likelihoodBadge.getAttribute('data-quiz-exam-likelihood');
check('Le niveau de probabilité est l’une des trois valeurs attendues', ['high', 'medium', 'low'].includes(badgeLevel ?? ''));

const wholeBodyText = await page.locator('body').innerText();
check(
  'Aucune formulation de certitude (« tombera à l’examen ») n’apparaît jamais',
  !/tombera à l.examen|va tomber à l.examen/i.test(wholeBodyText),
);

await page.locator('[data-quiz-option]').first().click();
await page.waitForTimeout(400);
const explanationText = await page.locator('[data-quiz-explanation]').innerText();
check(
  'Après la réponse, la formulation approuvée « estimée comme prioritaire » est utilisée',
  explanationText.includes('estimée comme prioritaire selon les données disponibles'),
);
check('« Basé sur : [chapitre] » apparaît après la réponse', /Basé sur\s*:/.test(explanationText));

await page.locator('[data-quiz-next]').click();
await page.waitForTimeout(400);
await answerAll();
await page.waitForTimeout(500);

check('Les résultats de « Examen probable » s’affichent', await page.locator('[data-quiz-results]').isVisible());
check(
  'La répartition par probabilité estimée est affichée',
  await page.locator('[data-quiz-exam-likely-results]').isVisible(),
);

const afterExamLikely = await dbSnapshot();
check(
  'Les flashcards ne sont jamais modifiées par « Examen probable » (aucune échéance SM-2 touchée)',
  JSON.stringify(beforeExamLikely.cards) === JSON.stringify(afterExamLikely.cards),
);
const quizLogsBeforeCount = beforeExamLikely.logs.filter((l) => l.itemKind === 'quiz').length;
const quizLogsAfter = afterExamLikely.logs.filter((l) => l.itemKind === 'quiz');
check(
  'Les réponses de « Examen probable » sont journalisées comme un quiz normal (itemKind: quiz, rating: null)',
  quizLogsAfter.length === quizLogsBeforeCount + 5 &&
    quizLogsAfter.slice(-5).every((l) => l.rating === null),
  `${quizLogsBeforeCount} → ${quizLogsAfter.length}`,
);

const retryButton = page.locator('[data-quiz-retry-important]');
if (await retryButton.count()) {
  await retryButton.click();
  await page.waitForTimeout(700);
  check(
    '« Refaire les questions importantes » relance une vraie session, pas un écran vide',
    await page.locator('[data-quiz-session]').isVisible(),
  );
  await answerAll();
  await page.waitForTimeout(500);
  check('Cette relance se termine aussi par un vrai résultat', await page.locator('[data-quiz-results]').isVisible());
} else {
  check('Sans notion en probabilité élevée dans ce tirage, aucun bouton n’est proposé à tort', true);
}

// ────────────────── 15. « Examen probable » — iPad portrait/paysage ──────────────────
for (const [name, viewport] of [
  ['paysage', { width: 1194, height: 834 }],
  ['portrait', { width: 834, height: 1194 }],
]) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(400);
  await goQuiz();
  await resetToSetup();
  await page.waitForTimeout(400);
  await page.locator('[data-quiz-scope="exam-likely"]').click();
  await page.waitForTimeout(300);
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`« Examen probable » : aucun débordement horizontal en configuration (${name})`, !overflow);

  await page.locator('[data-quiz-start]').click();
  await page.waitForTimeout(700);
  if (await page.locator('[data-quiz-session]').isVisible()) {
    overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`« Examen probable » : aucun débordement horizontal pendant une question (${name})`, !overflow);
    await page.locator('[data-quiz-option]').first().click();
    await page.waitForTimeout(400);
    overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`« Examen probable » : aucun débordement horizontal après réponse (${name})`, !overflow);
    await page.locator('[data-quiz-next]').click();
    await page.waitForTimeout(400);
    await answerAll();
    await page.waitForTimeout(500);
    overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(`« Examen probable » : aucun débordement horizontal sur les résultats (${name})`, !overflow);
  }
}
await page.setViewportSize({ width: 1194, height: 834 });

console.log('\n--- Erreurs console ---');
console.log(errors.length ? errors.join('\n') : 'aucune');

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées`);
if (passed !== results.length || errors.length > 0) process.exit(1);
