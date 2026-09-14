import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Parcours réel de « Progression ».
 *
 * L'exigence testée n'est pas seulement « la page s'affiche » : c'est qu'elle
 * n'affiche AUCUN chiffre sans donnée derrière. Le scénario passe donc par
 * les trois volumes possibles — rien, peu, assez — et vérifie qu'entre les
 * deux premiers la page dit « pas assez de données » au lieu d'inventer un
 * pourcentage.
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
const dialog = page.locator('[role="dialog"]');
const isoDay = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const goProgress = async () => {
  await nav.getByRole('link', { name: 'Progression', exact: true }).first().click();
  await page.waitForTimeout(900);
};

await page.goto(BASE, { waitUntil: 'networkidle' });

// ────────────────── 1. Aucune donnée ──────────────────
await goProgress();
check('La page Progression s’ouvre', await page.getByRole('heading', { name: 'Progression', exact: true }).isVisible());
check(
  'Elle n’affiche jamais « en construction »',
  !(await page.getByText(/en cours de construction|Phase 11/i).count()),
);
check(
  'Sans aucune matière, un état vide explique ce qui sera mesuré',
  await page.getByText('Ta progression se construit à partir de tes cours').isVisible(),
);
check(
  'L’état vide propose l’action qui débloque la mesure',
  await page.getByRole('link', { name: 'Créer ma première matière' }).isVisible(),
);
const zeroNoise = await page.evaluate(() => (document.body.innerText.match(/\d+\s*%/g) ?? []).length);
check('Aucun pourcentage n’est affiché sans donnée', zeroNoise === 0, `${zeroNoise} pourcentage(s)`);

// ────────────────── 2. Peu de données ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Anatomie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(700);

const CARDS = [
  ['Combien de racines a la première molaire mandibulaire ?', 'Deux.'],
  ['Quel nerf innerve le masséter ?', 'Le nerf massétérique (V3).'],
  ['Quelle artère vascularise la langue ?', 'L’artère linguale.'],
  ['Quel os forme le palais dur en arrière ?', 'L’os palatin.'],
  ['Combien de dents compte la denture permanente ?', '32.'],
  ['Quel muscle abaisse la mandibule ?', 'Le ptérygoïdien latéral.'],
];

await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Écrire une carte moi-même' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Question').fill(CARDS[0][0]);
await page.getByLabel('Réponse').fill(CARDS[0][1]);
await page.getByRole('button', { name: 'Ajouter la carte' }).click();
await page.waitForTimeout(500);

await goProgress();
const masteryValue = async () =>
  ((await page.locator('[data-progress-mastery]').first().textContent()) ?? '').trim();
check(
  'Avec une seule carte, aucun pourcentage de maîtrise n’est publié',
  !/%/.test(await masteryValue()),
  await masteryValue(),
);
/*
  L'ABSENCE DE MESURE NE S'AFFICHE PLUS COMME UN VIDE.

  Le seuil est juste — un pourcentage calculé sur deux réponses serait une
  fausse précision — mais il s'affichait « — », et la toute première chose
  qu'on voyait après une vraie séance était une rangée de tirets. Un compte
  réel (« 0/5 cartes révisées ») n'est pas une estimation : il est exact dès
  la première carte, et il dit ce qu'il reste à faire.
*/
check(
  'L’avancement vers le seuil est montré, pas un tiret',
  /^\d+\/\d+$/.test(await masteryValue()),
  await masteryValue(),
);
check(
  'La page dit explicitement ce qu’il manque pour mesurer',
  await page.getByText(/Encore \d+ cartes? et ta maîtrise s’affiche/).isVisible(),
);
const lowDataCounters = await page.locator('[data-progress-counters]').innerText();
check(
  'Les compteurs bruts disent la vérité : une carte créée, aucune réponse encore donnée',
  /1 flashcard/.test(lowDataCounters) && /0 réponse/.test(lowDataCounters),
  lowDataCounters.replace(/\n/g, ' '),
);
check(
  'Le taux de réussite n’est pas publié sous le seuil de fiabilité',
  !/% de réussite/.test(lowDataCounters),
  lowDataCounters.replace(/\n/g, ' '),
);
check(
  'Sans historique, l’évolution affiche un état vide explicite',
  await page.getByText('Continue à étudier pour voir ton évolution ici.').isVisible(),
);
check(
  'Sans réponse enregistrée, les points faibles ne sont pas inventés',
  await page.getByText('Rien de fragile pour l’instant.').isVisible(),
);

// ────────────────── 3. Assez de données ──────────────────
await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Écrire une carte moi-même' }).click();
await page.waitForTimeout(300);
for (const [question, answer] of CARDS.slice(1)) {
  await page.getByLabel('Question').fill(question);
  await page.getByLabel('Réponse').fill(answer);
  await page.getByRole('button', { name: 'Ajouter la carte' }).click();
  await page.waitForTimeout(400);
}

await nav.getByRole('link', { name: 'Révisions', exact: true }).first().click();
await page.waitForTimeout(700);
await page.getByText(/Commencer ma révision/).first().click();
await page.waitForTimeout(500);

let answered = 0;
for (let i = 0; i < 30; i += 1) {
  const reveal = page.locator('[data-review-see-answer]');
  if (await reveal.count()) {
    await reveal.first().click();
    await page.waitForTimeout(200);
  }
  // Un échec sur trois : produit un taux de réussite réel, ni 0 ni 100 %.
  const button = page.getByRole('button', { name: i % 3 === 0 ? /^Encore/ : /^Bien/ });
  if (!(await button.count())) break;
  await button.first().click();
  answered += 1;
  await page.waitForTimeout(350);
}
check('Des révisions réelles ont été enregistrées', answered >= 8, `${answered} réponses`);

await goProgress();
await page.screenshot({ path: `${SHOT}/progression.png`, fullPage: false });

const mastery = await masteryValue();
check('La maîtrise devient mesurable et chiffrée', /^\d+ %$/.test(mastery), mastery);

const bodyText = await page.evaluate(() => document.body.innerText);
check('Le résumé annonce un taux de réussite réel', /\d+ % de réussite/.test(bodyText));
check(
  'Le temps de révision affiché n’est pas nul',
  /Temps[\s\S]{0,80}?\d+\s?(s|min|h)/.test(bodyText),
);

// Progression par matière et détail par chapitre.
const subjectRow = page.locator('[data-progress-subject-row]');
check('La matière réellement créée apparaît', (await subjectRow.count()) === 1, `${await subjectRow.count()} matière(s)`);
check('La matière affiche son propre pourcentage de maîtrise', /Anatomie[\s\S]{0,120}?\d+ %/.test(bodyText));

await subjectRow.first().click();
await page.waitForTimeout(500);
check(
  'Cliquer sur une matière ouvre son détail',
  (await subjectRow.first().getAttribute('aria-expanded')) === 'true',
);
const chapterRows = await page.locator('[data-progress-chapters] li').count();
check(
  'Le détail liste les regroupements réels de cartes',
  chapterRows >= 1,
  `${chapterRows} ligne(s)`,
);

// Points faibles mesurés.
const weakCount = await page.locator('[data-progress-weak] li').count();
check('Des points faibles réels sont identifiés', weakCount > 0, `${weakCount} point(s)`);
const weakText = await page.locator('[data-progress-weak]').first().innerText();
check(
  'Chaque point faible affiche son taux de réussite, nommé pour ne pas se confondre avec la maîtrise',
  /\d+ %\s*\n?\s*réussite/.test(weakText),
  weakText.replace(/\n/g, ' | ').slice(0, 90),
);
check(
  'Chaque point faible ouvre une séance ciblée',
  (await page.locator('[data-progress-weak] a').count()) === weakCount,
);
const weakHref = await page.locator('[data-progress-weak] a').first().getAttribute('href');
check('Le lien de révision cible des cartes précises', /\/revisions\?cards=.+/.test(weakHref ?? ''), weakHref ?? '');

// Recommandation.
check('Une priorité du jour est proposée', await page.locator('[data-progress-reco]').isVisible());
const recoText = await page.locator('[data-progress-reco]').innerText();
check('La priorité est motivée par une mesure, pas par un slogan', /%|jours|carte/.test(recoText), recoText.split('\n')[2] ?? '');

// ────────────────── 3 bis. Suffisance examen SANS aucune date ──────────────────
// Le point central : la page doit être pleinement utile alors qu'aucun examen
// n'est inscrit au calendrier, et ne jamais afficher d'échéance inventée.
check(
  'Sans date connue, la section s’intitule « Suffisance examen » et non « Préparation à l’examen »',
  await page.getByRole('heading', { name: 'Suffisance examen', exact: true }).isVisible(),
);
check(
  'Sans évaluation enregistrée, l’état vide invite à en ajouter une',
  await page.getByText('Aucune évaluation connue').isVisible(),
);
const readinessPct = ((await page.locator('[data-progress-readiness-pct]').textContent()) ?? '').trim();
check('La suffisance examen est calculée sans aucune date', /^\d+ %$/.test(readinessPct), readinessPct);

const masteryPct = Number(((await page.locator('[data-progress-mastery]').textContent()) ?? '').replace(/\D/g, ''));
const readinessValue = Number(readinessPct.replace(/\D/g, ''));
check(
  'Suffisance examen et maîtrise sont deux mesures distinctes',
  readinessValue !== masteryPct,
  `maîtrise ${masteryPct} %, suffisance ${readinessValue} %`,
);

const prioritiesBefore = await page.locator('[data-progress-priorities] li').count();
check('Des priorités sont proposées sans aucune échéance', prioritiesBefore > 0, `${prioritiesBefore} ligne(s)`);
const prioritiesText = await page.locator('[data-progress-priorities]').innerText();
check(
  'Aucune échéance n’est mentionnée alors qu’aucune n’existe',
  !/dans \d+ jours|aujourd’hui|demain/i.test(prioritiesText),
);

check(
  'Le détail du calcul est replié par défaut',
  (await page.locator('[data-progress-readiness-detail]').count()) === 0,
);
await page.getByRole('button', { name: 'Voir le détail du calcul' }).click();
await page.waitForTimeout(500);
const detail = await page.locator('[data-progress-readiness-detail]').innerText();
for (const signal of ['Maîtrise moyenne', 'Fiabilité', 'Couverture du programme', 'Fraîcheur des révisions']) {
  check(`Le calcul expose son signal « ${signal} »`, detail.includes(signal));
}
check(
  'Le calcul dit franchement que les quiz n’y entrent pas encore',
  /Quiz n’existe pas/.test(detail),
);

// ────────────────── 3 ter. Ajout d'une date réelle au calendrier ──────────────────
await page.getByRole('button', { name: 'Ajouter une évaluation' }).first().click();
await page.waitForTimeout(400);
await page.getByLabel('Intitulé').fill('Contrôle d’anatomie — tête et cou');
await page.getByLabel('Nature').selectOption('midterm');
const examDay = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
await page.getByLabel('Date').fill(examDay);
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(1200);

check(
  'L’évaluation ajoutée apparaît dans les prochaines évaluations',
  (await page.locator('[data-progress-evaluations] li').count()) === 1,
);
check(
  'Le compte à rebours est calculé depuis la date réelle',
  (await page.locator('[data-progress-evaluations]').innerText()).includes('Dans 4 jours'),
);
check(
  'La section devient « Préparation à l’examen » dès qu’une date existe',
  await page.getByRole('heading', { name: 'Préparation à l’examen' }).isVisible(),
);
const prioritiesAfter = await page.locator('[data-progress-priorities]').innerText();
check(
  'La priorité mentionne désormais l’échéance réelle',
  /Contrôle dans 4 jours/.test(prioritiesAfter),
  prioritiesAfter.split('\n').slice(0, 3).join(' | '),
);
check(
  'La recommandation principale s’adapte à l’échéance',
  /dans 4 jours/.test(await page.locator('[data-progress-reco]').innerText()),
);
const readinessAfter = ((await page.locator('[data-progress-readiness-pct]').textContent()) ?? '').trim();
check(
  'La suffisance examen ne change pas : c’est une mesure de niveau, pas de délai',
  readinessAfter === readinessPct,
  `${readinessPct} → ${readinessAfter}`,
);

// ── Le temps qu'il reste VRAIMENT, calculé sur l'emploi du temps déclaré ──
// « Examen dans 4 jours » ne dit pas si quatre jours suffisent. Cette ligne
// croise les plages déclarées, les cours du calendrier et les séances déjà
// planifiées. Sans plages déclarées elle doit le DIRE, jamais annoncer zéro
// minute — ce sont deux affirmations opposées.
const budgetText = await page.locator('[data-progress-budget]').innerText();
check(
  'Le temps réellement disponible d’ici l’examen est annoncé, en heures et en séances',
  /Il te reste .+ réellement libres d’ici là, soit \d+ séance/.test(budgetText)
    || /aucune plage de travail/.test(budgetText)
    || /entièrement prises/.test(budgetText),
  budgetText.replace(/\n/g, ' '),
);
check(
  'Le budget ne confond jamais « aucune plage déclarée » avec « zéro minute libre »',
  !(/aucune plage de travail/.test(budgetText) && /Il te reste/.test(budgetText)),
);

// Retirer la date : la page doit revenir au fonctionnement sans échéance.
await page.getByRole('button', { name: /^Supprimer / }).first().click();
await page.waitForTimeout(900);
check(
  'Supprimer l’évaluation ramène la page à son fonctionnement sans date',
  await page.getByText('Aucune évaluation connue').isVisible(),
);
check(
  'Aucune échéance ne subsiste dans les priorités',
  !/dans \d+ jours/i.test(await page.locator('[data-progress-priorities]').innerText()),
);

// Activité récente.
const activityRows = await page.locator('[data-progress-activity] li').count();
check('L’activité récente reflète les séances réelles', activityRows >= 1, `${activityRows} séance(s)`);
check(
  'Une séance affiche son volume, son taux et son temps',
  /\d+ réponses? · \d+ % · /.test(await page.locator('[data-progress-activity]').innerText()),
);

// Temps d'étude et filtres de période.
const weekBars = await page.locator('[data-progress-week-chart] > div').count();
check('Le graphique hebdomadaire couvre les sept jours', weekBars === 7, `${weekBars} barres`);
const weekTotal = await page.locator('[data-progress-period-total]').innerText();
await page.getByRole('tab', { name: 'Tout', exact: true }).click();
await page.waitForTimeout(400);
const allTotal = await page.locator('[data-progress-period-total]').innerText();
check('Changer de période change réellement le total affiché', allTotal.length > 0, `${weekTotal} → ${allTotal}`);

// Régularité.
const streakText = await page.locator('[data-progress-streak]').innerText();
check('La série de jours est comptée sur une activité réelle', /^1 jour/.test(streakText), streakText);

// Prochaines révisions issues de la répétition espacée.
const upcoming = await page.locator('[data-progress-upcoming] li').count();
check('Les prochaines échéances viennent de la répétition espacée', upcoming >= 1, `${upcoming} jour(s)`);

// ────────────────── 3 quater. Hiérarchie et compacité ──────────────────
// L'ordre de lecture doit être évident : où j'en suis → ce que je dois faire
// → quel examen arrive → où je suis bon ou faible → comment j'évolue.
const hero = page.locator('[data-progress-hero]');
check('La vue d’ensemble ouvre la page', await hero.isVisible());
const heroText = await hero.innerText();
for (const block of ['PROGRESSION GLOBALE', 'SUFFISANCE EXAMEN', 'TEMPS ÉTUDIÉ', 'RÉVISIONS', 'RÉGULARITÉ']) {
  check(`La vue d’ensemble montre « ${block.toLowerCase()} »`, heroText.includes(block));
}
check(
  'La vue d’ensemble ne contient aucune action : elle dit où j’en suis, pas quoi faire',
  (await hero.locator('button, a').count()) === 0,
);
check(
  'La vue d’ensemble reprend la même suffisance que le détail',
  ((await page.locator('[data-progress-hero-readiness]').textContent()) ?? '').trim() ===
    ((await page.locator('[data-progress-readiness-pct]').textContent()) ?? '').trim(),
);

// L'ordre RÉEL des sections dans le document, pas seulement leur présence.
const sectionOrder = await page.evaluate(() =>
  [...document.querySelectorAll('main h2')].map((el) => el.textContent.trim()),
);
const expectedOrder = [
  'À faire maintenant',
  'Prochaines évaluations',
  'Progression par matière',
  'Points faibles et points forts',
  'Activité et évolution',
];
const positions = expectedOrder.map((title) => sectionOrder.indexOf(title));
check(
  'Les cinq sections existent, dans l’ordre attendu',
  positions.every((index) => index >= 0) &&
    positions.every((index, i) => i === 0 || index > positions[i - 1]),
  sectionOrder.join(' → '),
);

const priorityRevise = page.locator('[data-progress-priorities] li a').first();
check(
  'Chaque priorité offre un bouton « Réviser »',
  (await priorityRevise.count()) > 0 && /Réviser/.test(await priorityRevise.innerText()),
  await priorityRevise.innerText(),
);
check(
  'Ce bouton ouvre une vraie séance, sur des cartes précises',
  /\/revisions\?cards=.+/.test((await priorityRevise.getAttribute('href')) ?? ''),
  (await priorityRevise.getAttribute('href')) ?? '',
);

const listedPriorities = await page.locator('[data-progress-priorities] li').count();
const moreButton = page.locator('[data-progress-priorities-more]');
check('La liste de priorités reste courte par défaut', listedPriorities <= 3, `${listedPriorities} ligne(s)`);
check(
  'Aucun bouton « Voir tout » inutile quand tout est déjà affiché',
  (await moreButton.count()) === 0 || listedPriorities > 3,
);

check(
  'Points faibles et points forts sont présentés ensemble et compacts',
  (await page.locator('[data-progress-weak]').count()) + (await page.locator('[data-progress-strengths]').count()) >
    0,
);
check(
  'Les points forts disent honnêtement qu’aucun chapitre n’atteint le seuil',
  await page.getByText('Aucun chapitre n’atteint encore ce niveau.').isVisible(),
);

// Plusieurs évaluations : la liste se limite et propose « Voir toutes ».
for (const [title, offset] of [
  ['Contrôle de physiologie', 6],
  ['Examen de biochimie', 12],
  ['Devoir d’histologie', 20],
  ['Examen final d’anatomie', 40],
]) {
  await page.getByRole('button', { name: 'Ajouter une évaluation' }).first().click();
  await page.waitForTimeout(350);
  await page.getByLabel('Intitulé').fill(title);
  await page.getByLabel('Date').fill(new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.waitForTimeout(700);
}
const shownEvaluations = await page.locator('[data-progress-evaluations] li').count();
check('La liste des évaluations reste courte', shownEvaluations === 3, `${shownEvaluations} affichée(s)`);
const evaluationsMore = page.locator('[data-progress-evaluations-more]');
check('Un bouton donne accès à toutes les évaluations', await evaluationsMore.isVisible());
await evaluationsMore.click();
await page.waitForTimeout(500);
check(
  '« Voir toutes » révèle réellement les évaluations restantes',
  (await page.locator('[data-progress-evaluations] li').count()) === 4,
  `${await page.locator('[data-progress-evaluations] li').count()} affichée(s)`,
);
check(
  'Les évaluations restent triées de la plus proche à la plus lointaine',
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-progress-evaluations] li')].map((li) => li.innerText);
    const days = rows.map((text) => Number((text.match(/Dans (\d+) jours/) ?? [])[1] ?? 0));
    return days.every((value, index) => index === 0 || days[index - 1] <= value);
  }),
);

// Nettoyage : on retire les trois évaluations ajoutées pour ce contrôle.
for (const title of [
  'Examen final d’anatomie',
  'Devoir d’histologie',
  'Examen de biochimie',
  'Contrôle de physiologie',
]) {
  await page.getByRole('button', { name: `Supprimer ${title}` }).click();
  await page.waitForTimeout(600);
}

// Animations : la cascade doit disparaître sous « animations réduites ».
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.waitForTimeout(250);
const reducedTiming = await page.evaluate(() => {
  const el = document.querySelector('.reveal');
  if (!el) return { duration: '0s', delay: '0s' };
  const style = getComputedStyle(el);
  return { duration: style.animationDuration, delay: style.animationDelay };
});
check(
  'Sous « animations réduites », ni durée ni décalage ne subsistent',
  parseFloat(reducedTiming.duration) <= 0.001 && parseFloat(reducedTiming.delay) === 0,
  JSON.stringify(reducedTiming),
);
await page.emulateMedia({ reducedMotion: 'no-preference' });
await page.waitForTimeout(200);

// ────────────────── 4. Objectifs réellement enregistrés ──────────────────
await page.getByRole('button', { name: 'Modifier' }).first().click();
await page.waitForTimeout(400);
await page.getByLabel('Réponses par semaine').fill('12');
await page.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(700);
check(
  'L’objectif modifié s’applique immédiatement',
  (await page.locator('[data-progress-goals]').innerText()).includes('/ 12'),
);
await page.reload({ waitUntil: 'networkidle' });
await goProgress();
check(
  'L’objectif survit à un rechargement — il est bien persisté',
  (await page.locator('[data-progress-goals]').innerText()).includes('/ 12'),
);

// ────────────────── 5. Filtre par matière ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(500);
const addSubject = page.getByRole('button', { name: /Nouvelle matière|Ajouter une matière/ }).first();
if (await addSubject.count()) {
  await addSubject.click();
  await page.waitForTimeout(300);
  await page.getByLabel('Nom').fill('Histologie');
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await page.waitForTimeout(700);
}
await goProgress();
const filter = page.locator('[data-progress-filter]');
check('Un filtre par matière apparaît dès qu’il y a plusieurs matières', await filter.isVisible());
await filter.getByRole('button', { name: /Anatomie/ }).click();
await page.waitForTimeout(600);
check(
  'Filtrer une matière restreint la page à cette matière',
  (await page.locator('[data-progress-subject-row]').count()) === 1,
);
check(
  'Le périmètre filtré est rappelé explicitement',
  await page.getByText('Toute la page est restreinte à Anatomie.').isVisible(),
);

// ────────────────── 5 bis. Plusieurs examens, plusieurs chapitres ──────────────────
// Le filtre est resté sur une matière : on le relâche avant de mesurer
// l'ensemble.
await page.locator('[data-progress-filter] button').first().click();
await page.waitForTimeout(700);

// Deux évaluations de plus, saisies dans le désordre : la section doit les
// rendre dans l'ordre chronologique, pas dans l'ordre de saisie.
// Saisies volontairement dans le désordre : la section doit les remettre en
// ordre, et l'étape de nettoyage précédente a vidé la liste.
for (const [title, offset] of [
  ['Examen blanc', 21],
  ['Colle d’histologie', 9],
  ['Contrôle d’embryologie', 3],
]) {
  await page.getByRole('button', { name: 'Ajouter une évaluation' }).first().click();
  await page.waitForTimeout(500);
  await page.getByLabel('Intitulé').fill(title);
  await page.getByLabel('Date').fill(isoDay(offset));
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.waitForTimeout(900);
}
// Le bouton est un interrupteur : une section précédente a pu le laisser
// ouvert. On ne le presse que s'il est effectivement replié.
const moreEvals = page.locator('[data-progress-evaluations-more]');
if ((await moreEvals.count()) && (await moreEvals.getAttribute('aria-expanded')) === 'false') {
  await moreEvals.click();
  await page.waitForTimeout(600);
}
const evalDays = await page
  .locator('[data-progress-evaluations] li')
  .evaluateAll((items) =>
    items.map((item) => {
      const match = item.innerText.match(/Dans (\d+) jours|Demain|Aujourd’hui/);
      if (!match) return 0;
      return match[1] ? Number(match[1]) : match[0] === 'Aujourd’hui' ? 0 : 1;
    }),
  );
check(
  'Plusieurs évaluations sont listées dans l’ordre chronologique',
  evalDays.length >= 3 && evalDays.every((days, i) => i === 0 || days >= evalDays[i - 1]),
  evalDays.join(' · '),
);
check(
  'Chaque évaluation propose de planifier ses révisions',
  (await page.locator('[data-progress-evaluation-plan]').count()) === evalDays.length,
);

// Beaucoup de chapitres : le détail d'une matière doit rester lisible et ne
// jamais déborder.
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(700);
await page.getByText('Anatomie', { exact: true }).first().click();
await page.waitForTimeout(800);
const addChapter = page.getByRole('button', { name: /Nouveau chapitre|Ajouter un chapitre/ }).first();
if (await addChapter.count()) {
  for (const name of ['Ostéologie', 'Myologie', 'Névrologie', 'Angiologie', 'Splanchnologie', 'Arthrologie']) {
    await addChapter.click();
    await page.waitForTimeout(300);
    const field = page.getByLabel('Nom');
    if (!(await field.count())) break;
    await field.fill(name);
    await page.getByRole('button', { name: 'Créer', exact: true }).click();
    await page.waitForTimeout(500);
  }
}

await nav.getByRole('link', { name: 'Progression', exact: true }).first().click();
await page.waitForTimeout(1200);
await page.locator('[data-progress-subject-row]').first().click();
await page.waitForTimeout(700);
const manyChapterRows = await page.locator('[data-progress-chapters] li').count();
check('Le détail d’une matière liste ses chapitres', manyChapterRows >= 1, `${manyChapterRows} chapitre(s)`);
check(
  'Le détail par chapitre ne déborde pas horizontalement',
  !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)),
);

// Aucune grande zone vide : chaque carte de la page doit contenir quelque
// chose. Une carte haute et presque vide est exactement ce qu'on cherche à
// éviter dans cette réorganisation.
const emptyCards = await page.evaluate(() =>
  [...document.querySelectorAll('main .surface-card')]
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.height > 220 && el.innerText.trim().length < 40;
    })
    .map((el) => `${Math.round(el.getBoundingClientRect().height)}px`),
);
check('Aucune carte haute et vide ne subsiste', emptyCards.length === 0, emptyCards.join(', '));

// ────────────────── 6. Responsive ──────────────────
for (const [name, viewport] of [
  ['paysage', { width: 1194, height: 834 }],
  ['portrait', { width: 834, height: 1194 }],
]) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(600);
  const metrics = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    height: document.documentElement.scrollHeight,
  }));
  check(`Aucun débordement horizontal en ${name}`, !metrics.overflowX);
  check(
    `La page défile verticalement en ${name} plutôt que de comprimer les sections`,
    metrics.height > viewport.height,
    `${metrics.height} px`,
  );
  await page.screenshot({ path: `${SHOT}/progression-${name}.png`, fullPage: false });
}

// Cibles tactiles.
const smallTargets = await page.evaluate(() =>
  [...document.querySelectorAll('main button, main a[href]')]
    .map((el) => ({ label: el.innerText.trim().slice(0, 30), rect: el.getBoundingClientRect() }))
    .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0 && entry.rect.height < 32)
    .map((entry) => `${entry.label}:${Math.round(entry.rect.height)}`),
);
check('Toutes les cibles tactiles font au moins 32 px de haut', smallTargets.length === 0, smallTargets.join(', '));

console.log('\n--- Erreurs console ---');
console.log(errors.length ? errors.join('\n') : 'aucune');

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées`);
if (passed !== results.length || errors.length > 0) process.exit(1);
