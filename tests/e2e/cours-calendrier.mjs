import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * COURS UNIVERSITAIRES dans le calendrier — parcours réel.
 *
 * Ce qui est vérifié : la création d'un cours ponctuel puis d'un cours
 * récurrent sur plusieurs jours, la modification et la suppression avec leurs
 * trois portées (cette occurrence / celle-ci et les suivantes / toute la
 * série), le fait qu'un cours BLOQUE réellement le créneau du planificateur,
 * qu'il n'est jamais compté comme du temps d'étude, l'emploi du temps
 * hebdomadaire, la persistance et les deux orientations d'iPad.
 *
 * La règle centrale — une série est UNE ligne, ses occurrences sont
 * calculées — est vérifiée en lisant IndexedDB : c'est la base qui fait foi.
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
const weekday = (day) => new Date(`${day}T12:00:00`).getDay();
const minutes = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/** Premier lundi à venir : les tests de récurrence ont besoin d'un repère stable. */
let mondayOffset = 1;
while (weekday(isoDay(mondayOffset)) !== 1) mondayOffset += 1;
const MONDAY = isoDay(mondayOffset);
const NEXT_MONDAY = isoDay(mondayOffset + 7);
const THIRD_MONDAY = isoDay(mondayOffset + 14);
const WEDNESDAY = isoDay(mondayOffset + 2);

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

/** Sélectionne une date en vue Semaine, en avançant jusqu'à la trouver. */
const selectDay = async (day) => {
  await page.getByRole('tab', { name: 'Semaine' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Aujourd’hui' }).click();
  await page.waitForTimeout(500);
  for (let step = 0; step < 10; step += 1) {
    const cell = page.locator(`[data-calendar-cell="${day}"]`);
    if (await cell.count()) {
      await cell.click();
      await page.waitForTimeout(700);
      return true;
    }
    await page.getByRole('button', { name: 'Période suivante' }).click();
    await page.waitForTimeout(500);
  }
  return false;
};

const goCalendar = async () => {
  await nav.getByRole('link', { name: 'Calendrier', exact: true }).first().click();
  await page.waitForTimeout(900);
};

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
      id: row.id,
      title: row.title,
      kind: row.kind,
      day: row.day,
      startTime: row.startTime ?? null,
      endTime: row.endTime ?? null,
      room: row.room ?? null,
      teacher: row.teacher ?? null,
      recurrence: row.recurrence ?? null,
      seriesId: row.seriesId ?? null,
      occurrenceDay: row.occurrenceDay ?? null,
      cancelled: row.cancelled ?? false,
    }));
  });

/** Ouvre le formulaire et remplit un événement ; `recurrence` = liste de jours. */
const createCourse = async ({ title, kind = 'lecture', day, start, end, room, teacher, recurrence, until }) => {
  await page.getByRole('button', { name: 'Nouvel événement' }).click();
  await page.waitForTimeout(400);
  await page.getByLabel('Titre').fill(title);
  await page.getByLabel('Type').selectOption(kind);
  await page.waitForTimeout(250);
  await page.getByLabel('Date').fill(day);
  if (start) await page.getByLabel('Heure de début').fill(start);
  if (end) await page.getByLabel('Heure de fin').fill(end);
  if (room) await page.getByLabel('Salle').fill(room);
  if (teacher) await page.getByLabel('Enseignant').fill(teacher);
  if (recurrence) {
    await page.getByLabel('Récurrence').selectOption('weekly');
    await page.waitForTimeout(300);
    for (const id of recurrence) {
      const chip = page.locator(`[data-recurrence-day="${id}"]`);
      if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
    }
    // Décocher les jours non demandés, laissés par le jour de la date choisie.
    for (const chip of await page.locator('[data-recurrence-day]').all()) {
      const id = await chip.getAttribute('data-recurrence-day');
      if (!recurrence.includes(id) && (await chip.getAttribute('aria-pressed')) === 'true') await chip.click();
    }
    if (until) await page.getByLabel('Jusqu’au').fill(until);
  }
  await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await page.waitForTimeout(1100);
};

/** Aucun débordement horizontal DANS la fenêtre : elle ne défile qu'en hauteur. */
const modalOverflow = () =>
  page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    if (!panel) return null;
    const rect = panel.getBoundingClientRect();
    const wider = [...panel.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > rect.right + 0.5 || r.left < rect.left - 0.5);
    });
    return {
      scrolls: panel.scrollWidth > panel.clientWidth,
      overflowX: getComputedStyle(panel).overflowX,
      outside: wider.length,
    };
  });

await page.goto(BASE, { waitUntil: 'networkidle' });

// ────────────────── 1. Une matière et des cartes, pour avoir de quoi planifier ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Anatomie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(700);

await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Écrire une carte moi-même' }).click();
await page.waitForTimeout(300);
for (const [question, answer] of [
  ['Combien de racines a la première molaire mandibulaire ?', 'Deux.'],
  ['Quel nerf innerve le masséter ?', 'Le nerf massétérique (V3).'],
  ['Quelle artère vascularise la langue ?', 'L’artère linguale.'],
]) {
  await page.getByLabel('Question').fill(question);
  await page.getByLabel('Réponse').fill(answer);
  await page.getByRole('button', { name: 'Ajouter la carte' }).click();
  await page.waitForTimeout(350);
}

// ────────────────── 2. Disponibilités larges : 08 h–21 h tous les jours ──────────────────
// Sans plage large, on ne pourrait pas distinguer « le planificateur évite le
// cours » de « le planificateur n'avait de toute façon pas la place ».
await goCalendar();
await page.locator('[data-calendar-availability]').click();
await page.waitForTimeout(500);
for (const [label, from, to] of [
  ['Matin', '08:00', '12:00'],
  ['Après-midi', '12:00', '18:00'],
  ['Soir', '18:00', '21:00'],
]) {
  const box = page.getByLabel(`Disponible le lundi : ${label}`);
  if (!(await box.isChecked())) await box.check();
  const slot = page.locator(
    `[data-availability-slot="${label === 'Matin' ? 'morning' : label === 'Soir' ? 'evening' : 'afternoon'}"]`,
  );
  await slot.getByLabel('De').fill(from);
  await slot.getByLabel('À').fill(to);
}
await page.getByLabel('Durée d’une séance planifiée').selectOption('90');
await page.waitForTimeout(200);
await page.locator('[data-availability-apply-all]').click();
await page.waitForTimeout(250);
await page.locator('[data-availability-save]').click();
await page.waitForTimeout(900);

// ────────────────── 3. Création d'un cours ponctuel ──────────────────
await createCourse({
  title: 'Anatomie — TP dissection',
  day: WEDNESDAY,
  start: '14:00',
  end: '16:00',
  room: 'Salle 12',
  teacher: 'Dr Popa',
});

check(
  'Le cours apparaît dans l’agenda du jour',
  (await page.locator('[data-calendar-lecture]').count()) >= 1,
);
const lectureText = await page.locator('[data-calendar-lecture]').first().innerText();
check(
  'Il est étiqueté « Cours », avec sa salle et son enseignant',
  /COURS/i.test(lectureText) && /Salle 12/.test(lectureText) && /Dr Popa/.test(lectureText),
  lectureText.replace(/\n/g, ' | '),
);
check(
  'Un cours ne se « commence » pas : ce n’est pas une séance d’étude',
  (await page.locator('[data-calendar-lecture] button').allInnerTexts()).join(' ') === 'Modifier Supprimer',
  (await page.locator('[data-calendar-lecture] button').allInnerTexts()).join(' / '),
);

const afterSingle = await storedEvents();
check(
  'Le cours ponctuel est UNE ligne, sans récurrence',
  afterSingle.filter((row) => row.kind === 'lecture').length === 1 &&
    afterSingle.find((row) => row.kind === 'lecture').recurrence === null,
);

// ────────────────── 4. Cours récurrent sur plusieurs jours ──────────────────
await createCourse({
  title: 'Histologie — CM',
  day: MONDAY,
  start: '08:00',
  end: '10:00',
  room: 'Amphi B',
  recurrence: ['monday', 'thursday'],
  until: isoDay(mondayOffset + 40),
});

const afterSeries = await storedEvents();
const master = afterSeries.find((row) => row.recurrence !== null);
check(
  'Une série récurrente est UNE seule ligne en base, pas une par séance',
  master !== undefined && afterSeries.filter((row) => row.kind === 'lecture').length === 2,
  `${afterSeries.length} lignes au total`,
);
check(
  'La récurrence enregistrée porte bien les deux jours choisis',
  master.recurrence.weekdays.join(',') === 'monday,thursday' && master.recurrence.startDay === MONDAY,
  JSON.stringify(master.recurrence),
);

await page.getByRole('tab', { name: 'Semaine' }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Période suivante' }).click();
await page.waitForTimeout(700);
check(
  'Les occurrences futures apparaissent sans avoir été créées à la main',
  (await page.locator('[data-calendar-lecture-chip]').count()) >= 2,
  `${await page.locator('[data-calendar-lecture-chip]').count()} occurrences visibles`,
);

// ────────────────── 5. Emploi du temps hebdomadaire ──────────────────
await page.getByRole('tab', { name: 'Emploi du temps' }).click();
await page.waitForTimeout(700);
check('L’emploi du temps affiche les sept jours', (await page.locator('[data-timetable-day]').count()) === 7);
const monday = await page.locator('[data-timetable-day="monday"]').innerText();
check(
  'Le lundi montre le cours à son heure, et le temps libre autour',
  /08:00–10:00\s+Histologie/.test(monday) && /libre/.test(monday),
  monday.replace(/\n/g, ' | '),
);
const sunday = await page.locator('[data-timetable-day="sunday"]').innerText();
check(
  'Un jour sans cours n’invente aucun cours',
  !/Histologie/.test(sunday),
  sunday.replace(/\n/g, ' | '),
);
await page.screenshot({ path: `${SHOT}/cours-emploi-du-temps.png` });

// ────────────────── 6. Les cours bloquent le planificateur ──────────────────
await page.getByRole('tab', { name: 'Mois' }).click();
await page.waitForTimeout(500);

// Un examen dans trois semaines : son plan produit plusieurs séances réparties
// sur des jours qui portent des cours — c'est là que le blocage se voit.
await page.getByRole('button', { name: 'Nouvel événement' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Titre').fill('Contrôle d’anatomie');
await page.getByLabel('Type').selectOption('midterm');
await page.getByLabel('Date').fill(isoDay(mondayOffset + 20));
await dialog.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(1100);

await page.locator('[data-calendar-upcoming] button').first().click();
await page.waitForTimeout(900);
const examPlan = await dialog
  .locator('[data-calendar-plan] li')
  .evaluateAll((items) => items.map((item) => ({ day: item.dataset.planDay, time: item.dataset.planTime })));
check('Le plan d’examen répartit plusieurs séances malgré les cours', examPlan.length >= 2, `${examPlan.length} séances`);
await dialog.getByRole('button', { name: 'Fermer' }).click();
await page.waitForTimeout(500);

await page.locator('[data-calendar-plan-week]').click();
await page.waitForTimeout(900);
const weekProposals = await page.locator('[data-plan-session]').evaluateAll((items) =>
  items.map((item) => ({
    day: item.querySelector('input[type="date"]').value,
    time: item.querySelector('input[type="time"]').value,
  })),
);
const proposals = [...examPlan, ...weekProposals];
check('Le planificateur propose malgré les cours', proposals.length >= 1, `${proposals.length} séance(s)`);

const busyByDay = new Map();
for (const row of await storedEvents()) {
  if (row.recurrence !== null || !row.startTime) continue;
  const list = busyByDay.get(row.day) ?? [];
  list.push([minutes(row.startTime), minutes(row.endTime ?? row.startTime)]);
  busyByDay.set(row.day, list);
}
// Les occurrences de la série ne sont pas en base : on les recalcule ici.
const seriesRanges = [minutes(master.startTime), minutes(master.endTime)];
const seriesWeekdays = new Set(master.recurrence.weekdays.map((id) => ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'].indexOf(id)));

check(
  'Aucune séance n’est placée pendant un cours récurrent',
  proposals.every(({ day, time }) => {
    if (!seriesWeekdays.has(weekday(day)) || day < master.recurrence.startDay) return true;
    const start = minutes(time);
    return start + 90 <= seriesRanges[0] || start >= seriesRanges[1];
  }),
  proposals.map((row) => `${row.day} ${row.time}`).join(', '),
);
check(
  'Aucune séance n’est placée pendant un cours ponctuel',
  proposals.every(({ day, time }) => {
    const start = minutes(time);
    return (busyByDay.get(day) ?? []).every(([from, to]) => start + 90 <= from || start >= to);
  }),
);
check(
  'Un jour dont le matin est pris par un cours reçoit sa séance APRÈS le cours',
  proposals.every(({ day, time }) =>
    seriesWeekdays.has(weekday(day)) && day >= master.recurrence.startDay
      ? minutes(time) >= seriesRanges[1]
      : true,
  ),
);
await page.screenshot({ path: `${SHOT}/cours-plan-autour.png` });
await page.locator('[data-plan-refuse]').click();
await page.waitForTimeout(600);

// ── Cas décisif : le SEUL jour disponible porte un cours. Le planificateur
// doit poser la séance après le cours, pas au début de la plage déclarée.
await page.locator('[data-calendar-availability]').click();
await page.waitForTimeout(500);
for (const label of ['Matin', 'Après-midi', 'Soir']) {
  const box = page.getByLabel(`Disponible le lundi : ${label}`);
  if (await box.isChecked()) await box.uncheck();
}
await page.locator('[data-availability-apply-all]').click();
await page.waitForTimeout(250);
await page.locator('[data-availability-day="monday"]').click();
await page.waitForTimeout(250);
await page.getByLabel('Disponible le lundi : Matin').check();
await page.locator('[data-availability-slot="morning"]').getByLabel('De').fill('08:00');
await page.locator('[data-availability-slot="morning"]').getByLabel('À').fill('12:00');
await page.waitForTimeout(200);
await page.locator('[data-availability-save]').click();
await page.waitForTimeout(900);

await page.locator('[data-calendar-plan-week]').click();
await page.waitForTimeout(900);
const mondayOnly = await page.locator('[data-plan-session]').evaluateAll((items) =>
  items.map((item) => ({
    day: item.querySelector('input[type="date"]').value,
    time: item.querySelector('input[type="time"]').value,
  })),
);
check(
  'Avec un seul jour disponible, la séance y est bien proposée',
  mondayOnly.length === 1 && weekday(mondayOnly[0].day) === 1,
  mondayOnly.map((row) => `${row.day} ${row.time}`).join(', '),
);
check(
  'Le cours l’emporte sur la plage déclarée : la séance commence APRÈS lui',
  mondayOnly.length === 1 && minutes(mondayOnly[0].time) >= 600,
  mondayOnly.map((row) => `${row.day} ${row.time}`).join(', '),
);
await page.locator('[data-plan-refuse]').click();
await page.waitForTimeout(600);

// ────────────────── 7. Un cours n'est pas du temps d'étude ──────────────────
await nav.getByRole('link', { name: 'Progression', exact: true }).first().click();
await page.waitForTimeout(1200);
const counters = await page.locator('[data-progress-counters]').innerText();
check(
  'Un cours n’ajoute aucune réponse à la progression',
  /0 réponse/.test(counters),
  counters.replace(/\n/g, ' '),
);
check(
  'Un cours n’apparaît nulle part comme une séance d’étude réalisée',
  (await page.locator('[data-progress-activity]').count()) === 0,
);
check(
  'Aucun temps d’étude n’est fabriqué à partir des cours',
  !/Histologie|dissection/.test(await page.locator('main').innerText()),
);
const logs = await page.evaluate(async () => {
  const open = indexedDB.open('musab-study');
  const db = await new Promise((resolve) => {
    open.onsuccess = () => resolve(open.result);
  });
  const rows = await new Promise((resolve) => {
    const request = db.transaction('reviewLogs').objectStore('reviewLogs').getAll();
    request.onsuccess = () => resolve(request.result);
  });
  db.close();
  return rows.length;
});
check('Un cours n’écrit rien dans reviewLogs', logs === 0, `${logs} lignes`);

// ────────────────── 8. Modifier UNE occurrence ──────────────────
await goCalendar();
check('La deuxième occurrence est atteignable dans la vue Semaine', await selectDay(NEXT_MONDAY));
await page.locator('[data-calendar-lecture]').first().getByRole('button', { name: 'Modifier' }).click();
await page.waitForTimeout(600);
check(
  'Modifier un cours récurrent demande d’abord la portée',
  await page.locator('[data-series-scope]').isVisible(),
);
check(
  'Les trois portées sont proposées',
  (await page.locator('[data-series-scope-option]').count()) === 3,
);
await page.locator('[data-series-scope-option="occurrence"]').click();
await page.waitForTimeout(600);
await page.getByLabel('Heure de début').fill('10:00');
await page.getByLabel('Heure de fin').fill('12:00');
await page.getByLabel('Salle').fill('Amphi C');
await dialog.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(1100);

const afterOccurrence = await storedEvents();
const exception = afterOccurrence.find((row) => row.seriesId !== null && row.occurrenceDay === NEXT_MONDAY);
check(
  'Modifier une occurrence écrit une exception, sans dupliquer la série',
  exception !== undefined && exception.startTime === '10:00' && exception.room === 'Amphi C',
  JSON.stringify(exception ?? null),
);
check(
  'La série elle-même n’a pas bougé',
  afterOccurrence.find((row) => row.id === master.id).startTime === '08:00',
);
const nextMondayText = await page.locator(`[data-calendar-cell="${NEXT_MONDAY}"]`).innerText();
check(
  'L’occurrence modifiée affiche sa nouvelle heure',
  /10:00/.test(nextMondayText),
  nextMondayText.replace(/\n/g, ' | '),
);
await selectDay(MONDAY);
check(
  'Les autres occurrences gardent l’horaire de la série',
  /08:00/.test(await page.locator(`[data-calendar-cell="${MONDAY}"]`).innerText()),
  (await page.locator(`[data-calendar-cell="${MONDAY}"]`).innerText()).replace(/\n/g, ' | '),
);
await selectDay(NEXT_MONDAY);

// ────────────────── 9. Modifier la série entière ──────────────────
await page.locator('[data-calendar-lecture]').first().getByRole('button', { name: 'Modifier' }).click();
await page.waitForTimeout(600);
await page.locator('[data-series-scope-option="series"]').click();
await page.waitForTimeout(600);
await page.getByLabel('Titre').fill('Histologie — CM (amphi)');
await dialog.getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(1100);
const afterSeriesEdit = await storedEvents();
check(
  'Modifier toute la série ne touche qu’une ligne, la définition',
  afterSeriesEdit.find((row) => row.id === master.id).title === 'Histologie — CM (amphi)' &&
    afterSeriesEdit.length === afterOccurrence.length,
  `${afterSeriesEdit.length} lignes`,
);

// ────────────────── 10. Supprimer une occurrence ──────────────────
await selectDay(THIRD_MONDAY);
const beforeCancel = await page.locator('[data-calendar-lecture]').count();
await page.locator('[data-calendar-lecture]').first().getByRole('button', { name: 'Supprimer' }).click();
await page.waitForTimeout(600);
await page.locator('[data-series-scope-option="occurrence"]').click();
await page.waitForTimeout(1100);
check(
  'Supprimer une occurrence la retire de cette date',
  (await page.locator('[data-calendar-lecture]').count()) === beforeCancel - 1,
);
const afterCancel = await storedEvents();
check(
  'La série survit à la suppression d’une occurrence',
  afterCancel.find((row) => row.id === master.id) !== undefined &&
    afterCancel.some((row) => row.occurrenceDay === THIRD_MONDAY && row.cancelled === true),
);

// ────────────────── 11. Persistance ──────────────────
await page.reload({ waitUntil: 'networkidle' });
await goCalendar();
await page.getByRole('tab', { name: 'Emploi du temps' }).click();
await page.waitForTimeout(800);
check(
  'L’emploi du temps survit à un rechargement',
  /Histologie/.test(await page.locator('[data-timetable-day="monday"]').innerText()),
);
check(
  'Le nombre de lignes en base n’a pas dérivé',
  (await storedEvents()).length === afterCancel.length,
);

// ────────────────── 12. Supprimer la série ──────────────────
await selectDay(MONDAY);
await page.locator('[data-calendar-lecture]').first().getByRole('button', { name: 'Supprimer' }).click();
await page.waitForTimeout(600);
await page.locator('[data-series-scope-option="series"]').click();
await page.waitForTimeout(1200);

const afterSeriesDelete = await storedEvents();
check(
  'Supprimer la série retire sa définition ET ses exceptions',
  !afterSeriesDelete.some((row) => row.id === master.id) &&
    !afterSeriesDelete.some((row) => row.seriesId === master.id),
  `${afterSeriesDelete.length} lignes restantes`,
);
check(
  'Le cours ponctuel, lui, est toujours là',
  afterSeriesDelete.some((row) => row.title === 'Anatomie — TP dissection'),
);
await page.getByRole('tab', { name: 'Emploi du temps' }).click();
await page.waitForTimeout(700);
const emptyTimetable = await page.locator('[data-calendar-timetable]').innerText();
check(
  'L’emploi du temps est vide une fois la série supprimée',
  !/Histologie/.test(emptyTimetable),
);
check(
  'Sans aucune série, il explique quoi faire au lieu d’afficher sept cartes vides',
  /Aucun cours récurrent/.test(emptyTimetable) &&
    (await page.locator('[data-timetable-day]').count()) === 0,
  emptyTimetable.replace(/\n/g, ' | ').slice(0, 90),
);

// ────────────────── 13. « Temps pour soi » ──────────────────
// Sport, repas, repos : du temps qui m'appartient. Il bloque le calendrier
// sans jamais compter comme du travail.
await page.getByRole('tab', { name: 'Semaine' }).click();
await page.waitForTimeout(500);
// Le premier lundi à venir — le seul jour déclaré disponible, et il tombe
// dans la fenêtre de sept jours du plan de semaine.
const personalDay = MONDAY;
await createCourse({
  title: 'Natation',
  kind: 'personal',
  day: personalDay,
  start: '08:00',
  end: '12:00',
  recurrence: ['monday', 'wednesday', 'friday', 'saturday', 'sunday', 'tuesday', 'thursday'],
});

const personalRows = (await storedEvents()).filter((row) => row.kind === 'personal');
check(
  'Un « temps pour soi » récurrent est enregistré comme une série',
  personalRows.length === 1 && personalRows[0].recurrence !== null,
  JSON.stringify(personalRows[0]?.recurrence ?? null),
);
check(
  'Il ne se voit attribuer aucune matière',
  personalRows[0].room === null && personalRows[0].teacher === null,
);

await selectDay(personalDay);
const personalCard = page.locator('[data-calendar-lecture][data-event-kind="personal"]').first();
check('Il apparaît dans l’agenda du jour', await personalCard.isVisible());
check(
  'Il porte son propre libellé, distinct des cours',
  /TEMPS POUR SOI/i.test(await personalCard.innerText()),
  (await personalCard.innerText()).replace(/\n/g, ' | '),
);
check(
  'Il ne se « commence » pas : ce n’est pas une séance d’étude',
  (await personalCard.locator('button').allInnerTexts()).join(' ') === 'Modifier Supprimer',
);

await page.getByRole('tab', { name: 'Emploi du temps' }).click();
await page.waitForTimeout(700);
check(
  'Il apparaît dans l’emploi du temps hebdomadaire',
  /Natation/.test(await page.locator('[data-calendar-timetable]').innerText()),
);
const timetableBlock = page.locator('[data-timetable-row="block"]').first();
check(
  'Chaque bloc de l’emploi du temps est un vrai bouton',
  (await timetableBlock.evaluate((el) => el.tagName.toLowerCase())) === 'button',
);
check(
  'Le temps libre tient sur UNE ligne par jour, pas une par créneau',
  (await page.locator('[data-timetable-day="monday"] [data-timetable-row="free"]').count()) <= 1,
);
await timetableBlock.click();
await page.waitForTimeout(700);
check(
  'Toucher un bloc ouvre sa série pour la modifier',
  (await dialog.count()) === 1 && (await page.getByLabel('Titre').inputValue()) === 'Natation',
  await page.getByLabel('Titre').inputValue(),
);
check(
  'La récurrence de la série est bien rechargée dans le formulaire',
  (await page.getByLabel('Récurrence').inputValue()) === 'weekly',
);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Il bloque réellement : disponible 08 h–12 h uniquement, natation 08 h–12 h,
// le planificateur ne doit rien proposer ce jour-là.
await page.getByRole('tab', { name: 'Mois' }).click();
await page.waitForTimeout(500);
await page.locator('[data-calendar-plan-week]').click();
await page.waitForTimeout(900);
const afterPersonal = await page.locator('[data-plan-session]').evaluateAll((items) =>
  items.map((item) => ({
    day: item.querySelector('input[type="date"]').value,
    time: item.querySelector('input[type="time"]').value,
  })),
);
check(
  'Aucune séance n’est posée sur un temps pour soi qui occupe toute la plage',
  afterPersonal.length === 0,
  afterPersonal.map((row) => `${row.day} ${row.time}`).join(', ') || 'aucune séance proposée',
);
check(
  'Le planificateur explique qu’il ne reste aucun créneau',
  /Aucun créneau libre|objectif hebdomadaire/.test(await dialog.innerText()),
);
await page.locator('[data-plan-refuse]').click();
await page.waitForTimeout(600);

const logsAfterPersonal = await page.evaluate(async () => {
  const open = indexedDB.open('musab-study');
  const db = await new Promise((resolve) => {
    open.onsuccess = () => resolve(open.result);
  });
  const rows = await new Promise((resolve) => {
    const request = db.transaction('reviewLogs').objectStore('reviewLogs').getAll();
    request.onsuccess = () => resolve(request.result);
  });
  db.close();
  return rows.length;
});
check('Un temps pour soi n’écrit rien dans reviewLogs', logsAfterPersonal === 0, `${logsAfterPersonal} lignes`);

// ────────────────── 14. Récurrence disponible pour tout genre ──────────────────
await page.getByRole('button', { name: 'Nouvel événement' }).click();
await page.waitForTimeout(500);
check(
  'Le choix « Récurrence » est visible dès l’ouverture, sans changer de type',
  await page.getByLabel('Récurrence').isVisible(),
);
check(
  'Il propose « Aucune » par défaut',
  (await page.getByLabel('Récurrence').inputValue()) === 'none',
);
check(
  'Les jours ne sont proposés qu’une fois la récurrence activée',
  (await page.locator('[data-event-recurrence]').count()) === 0,
);
await page.getByLabel('Récurrence').selectOption('weekly');
await page.waitForTimeout(350);
check(
  'Activer « Chaque semaine » révèle les sept jours et les deux dates',
  (await page.locator('[data-recurrence-day]').count()) === 7 &&
    (await page.getByLabel('À partir du').isVisible()) &&
    (await page.getByLabel('Jusqu’au').isVisible()),
);
const overflow = await modalOverflow();
check(
  'La fenêtre ne défile que verticalement, sans rien qui dépasse',
  overflow !== null && !overflow.scrolls && overflow.overflowX === 'hidden' && overflow.outside === 0,
  JSON.stringify(overflow),
);

// Les champs d'heure sont des contrôles natifs : sans correctif ils se
// dimensionnent sur leur contenu et se retrouvent plus étroits que les
// champs du dessus, alors qu'ils partagent la même classe.
await page.getByLabel('Type').selectOption('lecture');
await page.waitForTimeout(300);
const fieldBoxes = await page.evaluate(() => {
  const out = {};
  for (const label of ['Titre', 'Type', 'Date', 'Heure de début', 'Heure de fin', 'À partir du']) {
    const node = [...document.querySelectorAll('[role="dialog"] label')].find(
      (el) => el.textContent.trim() === label,
    );
    const control = node && document.getElementById(node.getAttribute('for'));
    if (!control) continue;
    const rect = control.getBoundingClientRect();
    out[label] = { w: Math.round(rect.width), h: Math.round(rect.height), x: Math.round(rect.left) };
  }
  return out;
});
check(
  'Le champ d’heure a exactement la taille des autres champs de la fenêtre',
  fieldBoxes['Heure de début'].w === fieldBoxes.Type.w &&
    fieldBoxes['Heure de début'].h === fieldBoxes.Type.h &&
    fieldBoxes['Heure de fin'].w === fieldBoxes.Date.w &&
    fieldBoxes['Heure de fin'].h === fieldBoxes.Date.h,
  JSON.stringify(fieldBoxes),
);
check(
  'Les champs d’une même ligne sont parfaitement alignés',
  fieldBoxes['Heure de début'].x === fieldBoxes.Type.x &&
    fieldBoxes['Heure de fin'].x === fieldBoxes.Date.x &&
    fieldBoxes['À partir du'].h === fieldBoxes.Type.h,
);
check(
  'Aucun champ ne dépasse la largeur du champ pleine largeur',
  Object.values(fieldBoxes).every((box) => box.w <= fieldBoxes.Titre.w),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ────────────────── 15. Vues et orientations iPad ──────────────────
for (const view of ['Mois', 'Semaine', 'Jour', 'Emploi du temps']) {
  await page.getByRole('tab', { name: view }).click();
  await page.waitForTimeout(600);
  check(`La vue ${view} se rend sans erreur`, await page.locator('main').isVisible());
}

for (const [name, viewport] of [
  ['paysage', { width: 1194, height: 834 }],
  ['portrait', { width: 834, height: 1194 }],
]) {
  await page.setViewportSize(viewport);
  for (const view of ['Semaine', 'Emploi du temps']) {
    await page.getByRole('tab', { name: view }).click();
    await page.waitForTimeout(600);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    check(`Aucun débordement horizontal — ${view} en ${name}`, !overflowX);
  }
  await page.screenshot({ path: `${SHOT}/cours-${name}.png` });

  await page.getByRole('button', { name: 'Nouvel événement' }).click();
  await page.waitForTimeout(500);
  await page.getByLabel('Type').selectOption('lecture');
  await page.getByLabel('Récurrence').selectOption('weekly');
  await page.waitForTimeout(400);
  const modal = await modalOverflow();
  check(
    `La fenêtre « Nouvel événement » ne déborde pas en ${name}`,
    modal !== null && !modal.scrolls && modal.overflowX === 'hidden' && modal.outside === 0,
    JSON.stringify(modal),
  );
  await page.screenshot({ path: `${SHOT}/cours-modal-${name}.png` });
  await page.keyboard.press('Escape');
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
