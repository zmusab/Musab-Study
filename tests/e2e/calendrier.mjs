import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Parcours réel du calendrier.
 *
 * Ce qui est vérifié : la création, la modification et la suppression d'un
 * événement, leur PERSISTANCE après rechargement, l'agrégation des cartes
 * dues (jamais une ligne par carte), le cycle de vie d'une séance et son
 * enregistrement dans le temps d'étude, le plan de révision avant un examen,
 * et le fait qu'aucune date ni aucun événement ne soit fabriqué.
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

// ────────────────── 3. Création d'un événement ──────────────────
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
  'La case du mois porte l’évaluation',
  (await page.locator(`[data-calendar-cell="${examDay}"]`).innerText()).includes('Contrôle'),
);

// ────────────────── 4. Persistance ──────────────────
await page.reload({ waitUntil: 'networkidle' });
await goCalendar();
check(
  'L’événement survit à un rechargement — il est bien persisté',
  (await page.locator('[data-calendar-upcoming] li').count()) === 1,
);

// ────────────────── 5. Modification ──────────────────
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

const planned = await dialog.locator('[data-calendar-plan] li').count();
check('Un plan est proposé, réparti sur plusieurs jours', planned >= 2, `${planned} séances`);
const planDays = await dialog.locator('[data-calendar-plan] li').evaluateAll((items) =>
  items.map((item) => item.innerText.split('\n')[0]),
);
check('Le plan ne place aucune séance deux fois le même jour', new Set(planDays).size === planDays.length);
await dialog.getByRole('button', { name: /Ajouter ces séances/ }).click();
await page.waitForTimeout(1200);

const sessionCells = await page.locator('[data-calendar-cell]').evaluateAll((items) =>
  items.filter((item) => item.querySelectorAll('span[title]').length > 0).length,
);
check('Les séances planifiées apparaissent dans la grille', sessionCells > 0, `${sessionCells} case(s)`);

// ────────────────── 6. Cycle de vie d'une séance ──────────────────
// La première séance du plan tombe aujourd'hui : on la retrouve sur le jour courant.
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

// ────────────────── 7. Modification et suppression ──────────────────
await goCalendar();
await page.locator('[data-calendar-upcoming] button').first().click();
await page.waitForTimeout(600);
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
check(
  'La suppression retire réellement l’événement',
  (await page.locator('[data-calendar-upcoming] li').count()) === 0,
);

// ────────────────── 8. Vues et navigation ──────────────────
await page.getByRole('tab', { name: 'Semaine' }).click();
await page.waitForTimeout(600);
check('La vue Semaine affiche sept jours', (await page.locator('[data-calendar-week] button').count()) === 7);
const titleBefore = await page.locator('[data-calendar-title]').innerText();
await page.getByRole('button', { name: 'Période précédente' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Période suivante' }).click();
await page.waitForTimeout(500);
check(
  'La navigation avant/arrière revient au même point',
  (await page.locator('[data-calendar-title]').innerText()) === titleBefore,
);

await page.getByRole('tab', { name: 'Jour' }).click();
await page.waitForTimeout(500);
check('La vue Jour n’affiche qu’une journée', (await page.locator('[data-calendar-week] button').count()) === 1);

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

// ────────────────── 9. Responsive ──────────────────
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
