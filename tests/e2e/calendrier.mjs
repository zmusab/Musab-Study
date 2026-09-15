import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Parcours réel du calendrier.
 *
 * Ce qui est vérifié : la création, la modification et la suppression d'un
 * événement, leur PERSISTANCE après rechargement, l'agrégation des cartes
 * dues (jamais une ligne par carte), le cycle de vie d'une séance et son
 * enregistrement dans le temps d'étude, la planification intelligente
 * (plages disponibles, charge de la journée, proposition acceptée / modifiée
 * / refusée) et le fait qu'aucune date ni aucun événement ne soit fabriqué.
 *
 * La règle centrale de la planification — RIEN n'est écrit dans
 * `calendarEvents` avant validation — est vérifiée en lisant directement
 * IndexedDB, pas l'écran : c'est la base qui fait foi.
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

const isoDay = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const TODAY = isoDay(0);
/** 0 = dimanche, comme `Date.getDay()`. */
const weekday = (day) => new Date(`${day}T12:00:00`).getDay();
/**
 * Les plages configurées au §3 : 14 h–18 h du lundi au vendredi, 10 h–12 h le
 * samedi, rien le dimanche. Sert à vérifier que le planificateur lit bien les
 * plages DU JOUR qu'il retient.
 */
const declaredSlot = (day) => {
  const id = weekday(day);
  if (id === 0) return null;
  return id === 6 ? [600, 720] : [840, 1080];
};
const withinDeclaredSlots = ({ day, time }) => {
  const range = declaredSlot(day);
  if (range === null || time === '') return false;
  return minutes(time) >= range[0] && minutes(time) < range[1];
};
/** Minutes depuis minuit, pour comparer des heures sans dépendre du fuseau. */
const minutes = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

await mkdir(SHOT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ ...devices['iPad Pro 11'] });
const page = await context.newPage();
const nav = page.locator('aside, nav.fixed');
const dialog = page.locator('[role="dialog"]');
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const goCalendar = async () => {
  await nav.getByRole('link', { name: 'Calendrier', exact: true }).first().click();
  await page.waitForTimeout(900);
};

/** Lecture directe de la table `calendarEvents` : la base, pas l'affichage. */
const storedEvents = () =>
  page.evaluate(async () => {
    const open = indexedDB.open('musab-study');
    const db = await new Promise((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const rows = await new Promise((resolve) => {
      const request = db.transaction('calendarEvents').objectStore('calendarEvents').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return rows.map((row) => ({
      title: row.title,
      kind: row.kind,
      day: row.day,
      startTime: row.startTime ?? null,
      endTime: row.endTime ?? null,
    }));
  });

await page.goto(BASE, { waitUntil: 'networkidle' });

// ────────────────── 1. Calendrier vierge ──────────────────
await goCalendar();
check('La page Calendrier s’ouvre', await page.getByRole('heading', { name: 'Calendrier', exact: true }).isVisible());
check(
  'Elle n’affiche jamais « en construction »',
  !(await page.getByText(/en cours de construction|Phase 8/i).count()),
);
check('La grille du mois est rendue', await page.locator('[data-calendar-month]').isVisible());
const cells = await page.locator('[data-calendar-cell]').count();
check('La grille couvre des semaines entières', cells % 7 === 0 && cells >= 28, `${cells} cases`);
check(
  'Sans donnée, la journée est annoncée libre plutôt que remplie',
  await page.getByText('Journée libre').isVisible(),
);
check(
  'Aucune évaluation n’est inventée',
  (await page.locator('[data-calendar-upcoming]').count()) === 0,
);

const emptyLoad = page.locator('[data-calendar-load]');
check(
  'La charge d’une journée vide est annoncée légère, sans minute inventée',
  (await emptyLoad.getAttribute('data-load-level')) === 'light' &&
    /0 min engagées/.test(await emptyLoad.innerText()),
  (await emptyLoad.innerText()).replace(/\n/g, ' '),
);

// ────────────────── 2. Données réelles ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Anatomie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(700);

await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(600);
const CARDS = [
  ['Combien de racines a la première molaire mandibulaire ?', 'Deux.'],
  ['Quel nerf innerve le masséter ?', 'Le nerf massétérique (V3).'],
  ['Quelle artère vascularise la langue ?', 'L’artère linguale.'],
  ['Quel os forme le palais dur en arrière ?', 'L’os palatin.'],
  ['Combien de dents compte la denture permanente ?', '32.'],
];
await page.getByRole('button', { name: 'Écrire une carte moi-même' }).click();
await page.waitForTimeout(300);
for (const [question, answer] of CARDS) {
  await page.getByLabel('Question').fill(question);
  await page.getByLabel('Réponse').fill(answer);
  await page.getByRole('button', { name: 'Ajouter la carte' }).click();
  await page.waitForTimeout(350);
}

await goCalendar();
const dueText = await page.locator('[data-calendar-due]').innerText();
check(
  'Les cartes dues sont AGRÉGÉES en une seule ligne, jamais une par carte',
  (await page.locator('[data-calendar-due]').count()) === 1 && /5 cartes/.test(dueText),
  dueText.replace(/\n/g, ' | '),
);
check(
  'La ligne de révision ouvre une vraie séance ciblée',
  /\/revisions\?cards=/.test(
    (await page.locator('[data-calendar-due] a').first().getAttribute('href')) ?? '',
  ),
);

// ────────────────── 3. Mes plages disponibles, jour par jour ──────────────────
// « Ne jamais supposer que je suis disponible toute la journée » — ni que
// tous les jours se ressemblent : chaque jour porte ses propres plages.
await page.locator('[data-calendar-availability]').click();
await page.waitForTimeout(500);
check('La fenêtre des disponibilités s’ouvre', await page.locator('[data-availability-form]').isVisible());
check(
  'Les sept jours de la semaine sont réglables',
  (await page.locator('[data-availability-day]').count()) === 7,
);
check(
  'Les trois plages du jour sélectionné sont proposées',
  (await page.locator('[data-availability-slot]').count()) === 3,
);

// Tout couper, partout : le planificateur doit alors se taire.
for (const label of ['Matin', 'Après-midi', 'Soir']) {
  const box = page.getByLabel(`Disponible le lundi : ${label}`);
  if (await box.isChecked()) await box.uncheck();
}
await page.waitForTimeout(200);
check(
  'Tout décocher un jour est un choix valide, annoncé honnêtement',
  /Aucune plage active le lundi/.test(await page.locator('[data-availability-total]').innerText()),
);
check(
  'Une journée sans plage n’interdit pas d’y ajouter une séance à la main',
  /à la main/.test(await page.locator('[data-availability-total]').innerText()),
);
await page.locator('[data-availability-apply-all]').click();
await page.waitForTimeout(200);
await page.locator('[data-availability-save]').click();
await page.waitForTimeout(900);

// Sans plage cochée, le planificateur ne doit RIEN proposer — et le dire.
await page.locator('[data-calendar-plan-week]').click();
await page.waitForTimeout(700);
check(
  'Sans aucune plage, aucune séance n’est proposée',
  (await page.locator('[data-plan-session]').count()) === 0,
);
check(
  'Le planificateur explique pourquoi il ne propose rien',
  /Aucun créneau libre/.test(await dialog.innerText()),
);
check(
  'Aucun bouton d’ajout n’est proposé quand il n’y a rien à ajouter',
  (await page.locator('[data-plan-accept]').count()) === 0,
);
await page.locator('[data-plan-refuse]').click();
await page.waitForTimeout(500);

// Une semaine réellement irrégulière : 14 h–18 h du lundi au vendredi,
// 10 h–12 h le samedi, rien le dimanche.
await page.locator('[data-calendar-availability]').click();
await page.waitForTimeout(500);
const slot = (id) => page.locator(`[data-availability-slot="${id}"]`);

await page.getByLabel('Disponible le lundi : Après-midi').check();
await slot('afternoon').getByLabel('De').fill('14:00');
await slot('afternoon').getByLabel('À').fill('18:00');
await page.getByLabel('Durée d’une séance planifiée').selectOption('45');
await page.waitForTimeout(200);
check(
  'Le total du jour est calculé sur ses plages réellement cochées',
  /4 h disponibles le lundi/.test(await page.locator('[data-availability-total]').innerText()),
  (await page.locator('[data-availability-total]').innerText()).slice(0, 70),
);
await page.locator('[data-availability-apply-all]').click();
await page.waitForTimeout(300);
check(
  '« Appliquer à tous les jours » remplit la semaine d’un geste',
  /28 h sur la semaine/.test(await page.locator('[data-availability-total]').innerText()),
  (await page.locator('[data-availability-total]').innerText()).slice(0, 90),
);

await page.locator('[data-availability-day="saturday"]').click();
await page.waitForTimeout(250);
await page.getByLabel('Disponible le samedi : Après-midi').uncheck();
await page.getByLabel('Disponible le samedi : Matin').check();
await slot('morning').getByLabel('De').fill('10:00');
await slot('morning').getByLabel('À').fill('12:00');
await page.waitForTimeout(200);
check(
  'Un jour peut avoir des plages différentes des autres',
  /2 h disponibles le samedi/.test(await page.locator('[data-availability-total]').innerText()),
  (await page.locator('[data-availability-total]').innerText()).slice(0, 70),
);

await page.locator('[data-availability-day="sunday"]').click();
await page.waitForTimeout(250);
await page.getByLabel('Disponible le dimanche : Après-midi').uncheck();
await page.waitForTimeout(200);
check(
  'Un jour peut être entièrement indisponible',
  /Aucune plage active le dimanche/.test(await page.locator('[data-availability-total]').innerText()),
);
await page.locator('[data-availability-save]').click();
await page.waitForTimeout(900);

await page.reload({ waitUntil: 'networkidle' });
await goCalendar();
await page.locator('[data-calendar-availability]').click();
await page.waitForTimeout(600);
const mondayKept =
  (await page.getByLabel('Disponible le lundi : Après-midi').isChecked()) &&
  (await slot('afternoon').getByLabel('De').inputValue()) === '14:00';
await page.locator('[data-availability-day="saturday"]').click();
await page.waitForTimeout(250);
const saturdayKept =
  (await page.getByLabel('Disponible le samedi : Matin').isChecked()) &&
  !(await page.getByLabel('Disponible le samedi : Après-midi').isChecked()) &&
  (await slot('morning').getByLabel('De').inputValue()) === '10:00';
await page.locator('[data-availability-day="sunday"]').click();
await page.waitForTimeout(250);
const sundayKept = /Aucune plage active le dimanche/.test(
  await page.locator('[data-availability-total]').innerText(),
);
check(
  'Les disponibilités de CHAQUE jour survivent à un rechargement',
  mondayKept && saturdayKept && sundayKept,
  `lundi=${mondayKept} samedi=${saturdayKept} dimanche=${sundayKept}`,
);
await dialog.getByRole('button', { name: 'Annuler' }).click();
await page.waitForTimeout(400);

// ────────────────── 4. Planifier ma semaine : proposer, refuser, valider ──────────────────
const beforePlan = await storedEvents();
check('Aucun événement n’existe encore en base', beforePlan.length === 0, `${beforePlan.length} lignes`);

await page.locator('[data-calendar-plan-week]').click();
await page.waitForTimeout(800);
const proposed = await page.locator('[data-plan-session]').count();
check('Une proposition de semaine est construite depuis les données réelles', proposed >= 1, `${proposed} séance(s)`);
const proposedRows = await page.locator('[data-plan-session]').evaluateAll((items) =>
  items.map((item) => ({
    day: item.querySelector('input[type="date"]').value,
    time: item.querySelector('input[type="time"]').value,
  })),
);
check(
  'Chaque séance proposée tombe dans les plages déclarées DE SON JOUR',
  proposedRows.length === proposed && proposedRows.every(withinDeclaredSlots),
  proposedRows.map((row) => `${row.day} ${row.time}`).join(', '),
);
check(
  'Aucune séance n’est proposée le jour déclaré indisponible',
  proposedRows.every((row) => weekday(row.day) !== 0),
);

await page.screenshot({ path: `${SHOT}/calendrier-plan-semaine.png` });

await page.locator('[data-plan-refuse]').click();
await page.waitForTimeout(800);
const afterRefusal = await storedEvents();
check(
  'REFUSER n’écrit rien : la base est intacte',
  afterRefusal.length === 0,
  `${afterRefusal.length} lignes`,
);

await page.locator('[data-calendar-plan-week]').click();
await page.waitForTimeout(800);
// Modifier la proposition avant de l'accepter : c'est une suggestion, pas une
// décision prise à ma place.
await page.getByLabel('Jour de la séance 1').fill(TODAY);
await page.getByLabel('Heure de la séance 1').fill('15:00');
await page.waitForTimeout(300);
const accepting = await page.locator('[data-plan-session]').count();
await page.locator('[data-plan-accept]').click();
await page.waitForTimeout(1200);

const afterAccept = await storedEvents();
check(
  'ACCEPTER écrit exactement les séances affichées, pas une de plus',
  afterAccept.length === accepting,
  `${afterAccept.length} lignes pour ${accepting} séance(s)`,
);
const modified = afterAccept.find((event) => event.day === TODAY);
check(
  'La modification apportée à la proposition est celle qui est enregistrée',
  modified !== undefined && modified.startTime === '15:00' && modified.endTime === '15:45',
  JSON.stringify(modified ?? null),
);
check(
  'Les séances validées sont des séances de révision, jamais des évaluations',
  afterAccept.every((event) => event.kind === 'review'),
);

await page.reload({ waitUntil: 'networkidle' });
await goCalendar();
check(
  'Le plan validé survit à un rechargement',
  (await storedEvents()).length === accepting,
);

// ────────────────── 5. Création d'un événement ──────────────────
await page.getByRole('button', { name: 'Nouvel événement' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Titre').fill('Contrôle d’anatomie');
await page.getByLabel('Type').selectOption('midterm');
const examDay = isoDay(9);
await page.getByLabel('Date').fill(examDay);
await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(1000);

check(
  'L’évaluation créée apparaît dans les prochaines évaluations',
  (await page.locator('[data-calendar-upcoming] li').count()) === 1,
);
check(
  'Le compte à rebours est calculé depuis la date réelle',
  (await page.locator('[data-calendar-upcoming]').innerText()).includes('J−9'),
);
check(
  'La journée de l’évaluation est sélectionnée et la détaille',
  (await page.locator('[data-calendar-evaluation]').count()) === 1,
);
check(
  'Le jour d’une évaluation est traité comme une journée chargée',
  (await page.locator('[data-calendar-load]').getAttribute('data-load-level')) === 'heavy',
);
check(
  'La case du mois porte l’évaluation',
  (await page.locator(`[data-calendar-cell="${examDay}"]`).innerText()).includes('Contrôle'),
);

// ────────────────── 6. Persistance ──────────────────
await page.reload({ waitUntil: 'networkidle' });
await goCalendar();
check(
  'L’événement survit à un rechargement — il est bien persisté',
  (await page.locator('[data-calendar-upcoming] li').count()) === 1,
);

// ────────────────── 7. Plan avant l'examen ──────────────────
await page.locator('[data-calendar-upcoming] button').first().click();
await page.waitForTimeout(700);
check('La préparation de l’examen s’ouvre', await dialog.getByText('Plan de révision proposé').isVisible());
const prep = await dialog.innerText();
check('La fiche donne le temps restant réel', /9 jours/.test(prep));
check('La fiche donne les cartes dues réelles', /CARTES DUES\s*\n?\s*5/.test(prep), prep.slice(0, 60));
check(
  'La fiche ne promet aucun résultat',
  !/chances de réussir|tu vas réussir/i.test(prep) && /pas une prévision de résultat/.test(prep),
);

const planRows = await dialog
  .locator('[data-calendar-plan] li')
  .evaluateAll((items) => items.map((item) => ({ day: item.dataset.planDay, time: item.dataset.planTime })));
check('Un plan est proposé, réparti sur plusieurs jours', planRows.length >= 2, `${planRows.length} séances`);
check(
  'Le plan ne place aucune séance deux fois le même jour',
  new Set(planRows.map((row) => row.day)).size === planRows.length,
);
check(
  'Chaque séance du plan reçoit un créneau réel dans les plages de SON jour',
  planRows.every(withinDeclaredSlots),
  planRows.map((row) => `${row.day} ${row.time}`).join(', '),
);
check(
  'Le plan saute le jour déclaré indisponible',
  planRows.every((row) => weekday(row.day) !== 0),
);
check(
  'Aucune séance n’est posée le jour même de l’évaluation',
  planRows.every((row) => row.day !== examDay),
);
await dialog.getByRole('button', { name: /Ajouter ces séances/ }).click();
await page.waitForTimeout(1200);

const sessionCells = await page.locator('[data-calendar-cell]').evaluateAll((items) =>
  items.filter((item) => item.querySelectorAll('span[title]').length > 0).length,
);
check('Les séances planifiées apparaissent dans la grille', sessionCells > 0, `${sessionCells} case(s)`);

// ────────────────── 8. Cycle de vie d'une séance ──────────────────
// La séance déplacée en §4 tombe aujourd'hui : on la retrouve sur le jour courant.
await page.getByRole('button', { name: 'Aujourd’hui' }).click();
await page.waitForTimeout(600);
const sessionCount = await page.locator('[data-calendar-session]').count();
check('Une séance planifiée est visible dans l’agenda du jour', sessionCount >= 1, `${sessionCount} séance(s)`);
check(
  'Une séance à venir est « Prévue »',
  (await page.locator('[data-calendar-session]').first().getAttribute('data-session-state')) === 'planned',
);

await page.locator('[data-calendar-start]').first().click();
await page.waitForTimeout(1200);
check(
  'Commencer une séance ouvre réellement la file de révision',
  page.url().includes('/revisions'),
  page.url().split('#')[1] ?? '',
);

await goCalendar();
await page.getByRole('button', { name: 'Aujourd’hui' }).click();
await page.waitForTimeout(600);
check(
  'La séance est passée à « En cours » et l’état est persisté',
  (await page.locator('[data-calendar-session]').first().getAttribute('data-session-state')) === 'started',
);

await page.waitForTimeout(1200); // laisser du temps réellement s'écouler
await page.locator('[data-calendar-complete]').first().click();
await page.waitForTimeout(1200);
check(
  'Terminer une séance la marque comme terminée',
  (await page.locator('[data-calendar-session]').first().getAttribute('data-session-state')) === 'done',
);

// Le temps mesuré doit remonter dans la Progression, sans être compté comme une réponse.
await nav.getByRole('link', { name: 'Progression', exact: true }).first().click();
await page.waitForTimeout(1200);
const counters = await page.locator('[data-progress-counters]').innerText();
check(
  'Une séance ne compte pas comme une réponse',
  /0 réponse/.test(counters),
  counters.replace(/\n/g, ' '),
);
const activity = await page.locator('[data-progress-activity]').innerText();
check('La séance terminée apparaît dans l’activité récente', /1 séance/.test(activity), activity.replace(/\n/g, ' | '));
const periodTotal = await page.locator('[data-progress-period-total]').innerText();
check('Le temps de la séance est réellement enregistré', !/^—$/.test(periodTotal.trim()), periodTotal);

// ────────────────── 9. Le travail déjà fait continue de peser ──────────────────
await goCalendar();
await page.getByRole('button', { name: 'Aujourd’hui' }).click();
await page.waitForTimeout(600);
const workedLoad = await page.locator('[data-calendar-load]').innerText();
check(
  'Une séance terminée reste comptée dans la charge de la journée',
  /déjà travaillées/.test(workedLoad),
  workedLoad.replace(/\n/g, ' '),
);
check(
  'Elle n’est plus une séance à faire',
  (await page.locator('[data-calendar-session][data-session-state="done"]').count()) >= 1 &&
    (await page.locator('[data-calendar-session][data-session-state="planned"]').count()) === 0,
);
check(
  'Créer un événement à la main reste possible sur une journée travaillée',
  await page.getByRole('button', { name: 'Nouvel événement' }).isEnabled(),
);

// ────────────────── 10. Journée chargée, conflit, examen d'une autre matière ──────────────────

// Une journée entièrement occupée : 14 h–18 h, soit toute la plage déclarée
// d'un jour ouvré. On saute le week-end, dont les plages sont différentes.
let busyOffset = 3;
while (weekday(isoDay(busyOffset)) % 6 === 0) busyOffset += 1; // ni samedi ni dimanche
const busyDay = isoDay(busyOffset);
await page.getByRole('button', { name: 'Nouvel événement' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Titre').fill('Stage clinique');
await page.getByLabel('Date').fill(busyDay);
await page.getByLabel('Heure de début').fill('14:00');
await page.getByLabel('Heure de fin').fill('18:00');
await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(1100);
const busyLoad = page.locator('[data-calendar-load]');
check(
  'Une journée occupée de bout en bout est annoncée chargée',
  (await busyLoad.getAttribute('data-load-level')) === 'heavy',
  (await busyLoad.innerText()).replace(/\n/g, ' '),
);

// Une deuxième matière, avec sa propre évaluation : la veille d'un examen
// d'une AUTRE matière ne doit pas se remplir de révisions.
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Nouvelle matière' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Nom').fill('Physiologie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(800);

await goCalendar();
let examOffset = busyOffset + 1;
while (weekday(isoDay(examOffset)) === 0) examOffset += 1; // pas le dimanche fermé
const otherExamDay = isoDay(examOffset);
const otherExamEve = isoDay(examOffset - 1);
await page.getByRole('button', { name: 'Nouvel événement' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Titre').fill('Partiel de physiologie');
await page.getByLabel('Type').selectOption('exam');
await page.getByLabel('Date').fill(otherExamDay);
await page.getByLabel('Matière').selectOption({ label: 'Physiologie' });
await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(1100);
check(
  'Les deux évaluations proches coexistent dans le calendrier',
  (await page.locator('[data-calendar-upcoming] li').count()) === 2,
);

await page
  .locator('[data-calendar-upcoming] button')
  .filter({ hasText: /anatomie/i })
  .first()
  .click();
await page.waitForTimeout(900);
const replanned = await dialog
  .locator('[data-calendar-plan] li')
  .evaluateAll((items) => items.map((item) => ({ day: item.dataset.planDay, time: item.dataset.planTime })));
check('Un plan reste proposé malgré les contraintes', replanned.length >= 1, `${replanned.length} séances`);
check(
  'Chaque séance replanifiée respecte encore les plages de son jour',
  replanned.every(withinDeclaredSlots),
  replanned.map((row) => `${row.day} ${row.time}`).join(', '),
);
check(
  'Aucune séance n’est posée sur une journée déjà pleine',
  replanned.every((row) => row.day !== busyDay),
  replanned.map((row) => row.day).join(', '),
);
check(
  'Aucune séance n’est posée la veille de l’examen d’une autre matière',
  replanned.every((row) => row.day !== otherExamEve),
  `veille = ${otherExamEve}`,
);

// Aucune séance ne doit chevaucher un créneau déjà occupé.
const busyByDay = new Map();
for (const event of await storedEvents()) {
  if (!event.startTime) continue;
  const list = busyByDay.get(event.day) ?? [];
  list.push([minutes(event.startTime), minutes(event.endTime ?? event.startTime)]);
  busyByDay.set(event.day, list);
}
check(
  'Aucune séance proposée n’entre en conflit avec un créneau occupé',
  replanned.every((row) => {
    if (!row.time) return true;
    const start = minutes(row.time);
    const end = start + 45;
    return (busyByDay.get(row.day) ?? []).every(([from, to]) => end <= from || start >= to);
  }),
);
await dialog.getByRole('button', { name: 'Fermer' }).click();
await page.waitForTimeout(500);

// ────────────────── 11. Modification et suppression ──────────────────
await page
  .locator('[data-calendar-upcoming] button')
  .filter({ hasText: /anatomie/i })
  .first()
  .click();
await page.waitForTimeout(700);
await dialog.getByRole('button', { name: 'Fermer' }).click();
await page.waitForTimeout(400);
await page.locator('[data-calendar-evaluation]').getByRole('button', { name: 'Modifier' }).click();
await page.waitForTimeout(500);
await page.getByLabel('Titre').fill('Contrôle d’anatomie — tête et cou');
await dialog.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(900);
check(
  'La modification est enregistrée',
  (await page.locator('[data-calendar-upcoming]').innerText()).includes('tête et cou'),
);

await page.locator('[data-calendar-evaluation]').getByRole('button', { name: 'Supprimer' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Supprimer', exact: true }).last().click();
await page.waitForTimeout(900);
const remaining = await page.locator('[data-calendar-upcoming]').innerText();
check(
  'La suppression retire réellement l’événement visé, et lui seul',
  !/tête et cou/.test(remaining) && /physiologie/i.test(remaining),
  remaining.replace(/\n/g, ' | '),
);

// ────────────────── 12. Vues et navigation ──────────────────
await page.getByRole('tab', { name: 'Semaine' }).click();
await page.waitForTimeout(600);
check('La vue Semaine affiche sept jours', (await page.locator('[data-calendar-week] button').count()) === 7);

// L'intitulé doit dire DE QUELLE semaine il s'agit. Il affichait le mois et
// l'année dans les trois vues : on avançait de sept jours sans que le titre
// bouge, donc sans savoir où l'on venait d'arriver.
const weekTitle = await page.locator('[data-calendar-title]').innerText();
check(
  'En vue Semaine, l’intitulé donne la plage de dates et non le seul mois',
  /^\d{1,2}(\s+\w+)?\s+–\s+\d{1,2}\s+\w+\s+\d{4}$/.test(weekTitle.trim()),
  weekTitle,
);
const titleBefore = await page.locator('[data-calendar-title]').innerText();
await page.getByRole('button', { name: 'Période précédente' }).click();
await page.waitForTimeout(500);
const previousWeekTitle = await page.locator('[data-calendar-title]').innerText();
check(
  'Changer de semaine change réellement l’intitulé',
  previousWeekTitle !== titleBefore,
  `${titleBefore} → ${previousWeekTitle}`,
);
await page.getByRole('button', { name: 'Période suivante' }).click();
await page.waitForTimeout(500);
check(
  'La navigation avant/arrière revient au même point',
  (await page.locator('[data-calendar-title]').innerText()) === titleBefore,
);

await page.getByRole('tab', { name: 'Jour' }).click();
await page.waitForTimeout(500);
check('La vue Jour n’affiche qu’une journée', (await page.locator('[data-calendar-week] button').count()) === 1);
check(
  'En vue Jour, l’intitulé nomme le jour affiché, pas son mois',
  /^[A-ZÀ-Þ][a-zà-ÿ]+\s+\d{1,2}\s+\w+$/.test((await page.locator('[data-calendar-title]').innerText()).trim()),
  await page.locator('[data-calendar-title]').innerText(),
);
check(
  'La charge du jour reste lisible dans chaque vue',
  (await page.locator('[data-calendar-load]').count()) === 1,
);

await page.getByRole('tab', { name: 'Mois' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Période suivante' }).click();
await page.waitForTimeout(500);
const otherMonth = await page.locator('[data-calendar-title]').innerText();
await page.getByRole('button', { name: 'Aujourd’hui' }).click();
await page.waitForTimeout(500);
check(
  '« Aujourd’hui » ramène au mois courant',
  (await page.locator('[data-calendar-title]').innerText()) !== otherMonth,
);

// ────────────────── 13. Responsive ──────────────────
for (const [name, viewport] of [
  ['paysage', { width: 1194, height: 834 }],
  ['portrait', { width: 834, height: 1194 }],
]) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(600);
  const metrics = await page.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  }));
  check(`Aucun débordement horizontal en ${name}`, !metrics.overflowX);
  await page.screenshot({ path: `${SHOT}/calendrier-${name}.png` });

  // Les deux fenêtres de planification doivent tenir dans les deux orientations.
  await page.locator('[data-calendar-plan-week]').click();
  await page.waitForTimeout(700);
  const planOverflow = await page.evaluate(() => {
    const node = document.querySelector('[role="dialog"]');
    return node ? node.scrollWidth > node.clientWidth + 1 : true;
  });
  check(`La proposition de plan tient dans la largeur en ${name}`, !planOverflow);
  await page.screenshot({ path: `${SHOT}/calendrier-plan-${name}.png` });
  await page.locator('[data-plan-refuse]').click();
  await page.waitForTimeout(400);

  await page.locator('[data-calendar-availability]').click();
  await page.waitForTimeout(600);
  const availOverflow = await page.evaluate(() => {
    const node = document.querySelector('[role="dialog"]');
    return node ? node.scrollWidth > node.clientWidth + 1 : true;
  });
  check(`La fenêtre des disponibilités tient dans la largeur en ${name}`, !availOverflow);
  await page.screenshot({ path: `${SHOT}/calendrier-disponibilites-${name}.png` });
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await page.waitForTimeout(400);
}

const smallTargets = await page.evaluate(() =>
  [...document.querySelectorAll('main button, main a[href]')]
    .map((el) => ({ label: el.innerText.trim().slice(0, 24), rect: el.getBoundingClientRect() }))
    .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0 && entry.rect.height < 28)
    .map((entry) => `${entry.label}:${Math.round(entry.rect.height)}`),
);
check('Les cibles tactiles restent utilisables', smallTargets.length === 0, smallTargets.join(', '));

console.log('\n--- Erreurs console ---');
console.log(errors.length ? errors.join('\n') : 'aucune');

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées`);
if (passed !== results.length || errors.length > 0) process.exit(1);
