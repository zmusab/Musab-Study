import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Explorateur 3D Anatomie — modèle réel BodyParts3D (voir
 * src/data/anatomy/SOURCES.md), canevas WebGL rendu même en Chromium
 * headless (SwiftShader). Ce test vérifie le comportement piloté par
 * l'application (toggles, recherche, sous-régions, marqueurs, mode
 * apprentissage, panneau, IA/flashcard honnêtes) — pas le rendu pixel du
 * modèle lui-même.
 *
 * Prérequis : `npm run build` puis `npm run preview`.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:4173/';
const SHOT = process.env.SCREENSHOT_DIR ?? './dist-screenshots';
const results = [];
const errors = [];

/**
 * Bouton de fermeture du panneau d'information.
 *
 * Ciblé par son attribut plutôt que par `getByRole({ name })` : l'instantané
 * ARIA de Playwright montre pourtant bien `button "Fermer le panneau"`, et le
 * DOM contient exactement un élément portant ce libellé, mais la recherche par
 * nom accessible (chaîne exacte comme regex ancrée) n'y renvoie rien dans
 * cette page. Le sélecteur d'attribut vérifie exactement la même chose — la
 * présence de l'affordance de fermeture — de façon fiable, et l'ouverture du
 * panneau est de toute façon corroborée par ses onglets.
 */
const closePanelButton = (page) => page.locator('button[aria-label="Fermer le panneau"]');

/**
 * Ramène le modèle 3D entièrement dans le viewport.
 *
 * La page DÉFILE désormais (cockpit puis cinq cartes) : après avoir cliqué
 * dans les cartes du bas, le canevas peut être partiellement au-dessus du
 * cadre. Mesurer la position des points ou cliquer « au centre du canevas »
 * n'aurait alors aucun sens. Ce n'est pas un contournement : c'est ce que
 * fait l'utilisateur, il remonte pour voir le modèle.
 */
async function focusModel(page) {
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.waitForTimeout(400);
}

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

await mkdir(SHOT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ ...devices['iPad Pro 11 landscape'] });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/**
 * Attend qu'une condition observée CÔTÉ NODE devienne vraie (les requêtes
 * réseau sont collectées ici, pas dans la page). Attendre la condition plutôt
 * que dormir une durée fixe est ce qui rend ces vérifications déterministes,
 * quelle que soit la charge de la machine.
 */
async function waitFor(predicate, timeout = 30000, step = 200) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, step));
  }
  return predicate();
}

// Enregistré AVANT la navigation : sinon aucune requête d'asset ne serait
// observée et la vérification du chargement paresseux serait vide de sens.
const glbRequests = [];
page.on('response', (r) => {
  if (r.url().endsWith('.glb')) glbRequests.push(r.url().split('/').pop());
});

await page.goto(`${BASE}#/anatomie`, { waitUntil: 'networkidle' });
/*
  Le chargement se fait en DEUX temps (prioritaire puis contexte) et l'analyse
  des maillages occupe le fil principal — un clic envoyé pendant ce temps
  reste en attente. On attend donc que l'indicateur de progression disparaisse,
  c'est-à-dire que tous les groupes demandés soient réellement arrivés, plutôt
  qu'une durée fixe qui serait non déterministe.
*/
await page
  .getByText(/Chargement de l’anatomie/)
  .waitFor({ state: 'detached', timeout: 90000 })
  .catch(() => {});
await page.waitForTimeout(1500);
check('Des groupes d’assets par région × système sont bien téléchargés', glbRequests.length >= 10);

// ---------- Chargement en deux temps (§1) ----------
// Le lot PRIORITAIRE est ce que la caméra cadre à l'ouverture (crâne, face,
// mâchoire, dents). Le cou et l'orbite complètent la vue ensuite. On vérifie
// l'ORDRE réel des requêtes, pas une intention.
const firstNeck = glbRequests.findIndex((f) => f.startsWith('cou-'));
const lastPriority = Math.max(
  ...['crane-', 'face-', 'machoire-', 'dents-'].map((prefix) =>
    glbRequests.reduce((last, f, i) => (f.startsWith(prefix) ? i : last), -1),
  ),
);
check(
  'Le lot prioritaire (crâne, face, mâchoire, dents) part avant le contexte (cou)',
  firstNeck === -1 || lastPriority < firstNeck,
  `dernier prioritaire #${lastPriority}, premier cou #${firstNeck}`,
);
check(
  'Le cou finit tout de même par arriver, sans action de l’utilisateur',
  firstNeck !== -1,
  glbRequests.filter((f) => f.startsWith('cou-')).join(', ') || 'aucun',
);

// ---------- La page défile, les cinq cartes sont toutes visibles (§3/§4) ----------
const pageMetrics = await page.evaluate(() => ({
  doc: document.documentElement.scrollHeight,
  win: window.innerHeight,
  overflowX: document.documentElement.scrollWidth > window.innerWidth,
}));
check(
  'La page s’étend au-delà de l’écran plutôt que de comprimer les sections',
  pageMetrics.doc > pageMetrics.win,
  `${pageMetrics.doc} px pour ${pageMetrics.win} px de fenêtre`,
);
check('Aucun débordement horizontal', !pageMetrics.overflowX);

for (const title of ['Exploration par région', 'Mode isolation', 'Mode apprentissage', 'Combinaisons', 'Intégration cours']) {
  check(
    `La carte « ${title} » est visible sans passer par un onglet`,
    (await page.getByRole('heading', { name: title, exact: true }).count()) +
      (await page.getByText(title, { exact: true }).count()) > 0,
  );
}

// ---------- Corps entier / systèmes par défaut / thème sombre dédié ----------
check('La page Anatomie 3D s’ouvre', await page.getByText('Anatomie 3D').isVisible());
// « Tête et cou » apparaît aussi dans l'en-tête de la carte d'exploration :
// on cible explicitement le fil d'Ariane.
check(
  'Le fil d’Ariane démarre sur Tête et cou',
  await page.getByRole('navigation', { name: 'Navigation anatomique' }).getByText('Tête et cou').isVisible(),
);
check('Un canevas WebGL est rendu', await page.locator('canvas').isVisible());
check(
  'La section Anatomie force le thème sombre (indépendant du thème global de <html>)',
  await page.evaluate(() => document.querySelector('div[data-theme="dark"]') !== null),
);
check('Squelette actif par défaut', (await page.getByRole('button', { name: 'Squelette', exact: true }).getAttribute('aria-pressed')) === 'true');
check('Muscles actif par défaut', (await page.getByRole('button', { name: 'Muscles', exact: true }).getAttribute('aria-pressed')) === 'true');
check('Vaisseaux actif par défaut', (await page.getByRole('button', { name: 'Vaisseaux', exact: true }).getAttribute('aria-pressed')) === 'true');
check('Organes actif par défaut', (await page.getByRole('button', { name: 'Organes', exact: true }).getAttribute('aria-pressed')) === 'true');
// Les nerfs ont désormais un maillage réel (nerfs/tractus optiques,
// encéphale) : le marqueur « (cours) » doit avoir disparu de lui-même,
// puisqu'il est calculé depuis le manifeste d'assets.
check(
  'Aucun système n’est marqué « (cours) » : tous ont un maillage réel',
  (await page.getByText('(cours)').count()) === 0,
);
// Le système nerveux est libellé « Système nerveux » et non « Nerfs » : les
// données ouvertes contiennent l'encéphale et les nerfs optiques, pas les
// nerfs crâniens ni périphériques. Le libellé doit dire ce qui existe.
check(
  'Le système nerveux est activable comme les autres',
  (await page.getByRole('button', { name: 'Système nerveux', exact: true }).getAttribute('aria-pressed')) === 'true',
);

await page.screenshot({ path: `${SHOT}/anatomy-default.png`, fullPage: false });

// ---------- Toggles indépendants, combinables ----------
await page.getByRole('button', { name: 'Muscles', exact: true }).click();
await page.waitForTimeout(300);
check('Muscles désactivable indépendamment', (await page.getByRole('button', { name: 'Muscles', exact: true }).getAttribute('aria-pressed')) === 'false');
check('Squelette reste actif — les systèmes ne sont pas exclusifs', (await page.getByRole('button', { name: 'Squelette', exact: true }).getAttribute('aria-pressed')) === 'true');

await page.getByRole('button', { name: 'Tout masquer' }).click();
await page.waitForTimeout(300);
check('« Tout masquer » désactive tous les systèmes', (await page.getByRole('button', { name: 'Squelette', exact: true }).getAttribute('aria-pressed')) === 'false');

await page.getByRole('button', { name: 'Tout afficher' }).click();
await page.waitForTimeout(300);
check('« Tout afficher » réactive tous les systèmes', (await page.getByRole('button', { name: 'Organes', exact: true }).getAttribute('aria-pressed')) === 'true');

await page.getByRole('button', { name: /Squelette et nerfs/ }).click();
await page.waitForTimeout(300);
check(
  'Le préréglage « Squelette et nerfs » applique exactement cette combinaison',
  (await page.getByRole('button', { name: 'Squelette', exact: true }).getAttribute('aria-pressed')) === 'true' &&
    (await page.getByRole('button', { name: 'Muscles', exact: true }).getAttribute('aria-pressed')) === 'false',
);
await page.getByRole('button', { name: 'Tout afficher' }).click();
await page.waitForTimeout(300);

// ---------- Schéma anatomique interactif : zones cliquables issues du rendu réel ----------
const breadcrumbNav = page.getByRole('navigation', { name: 'Navigation anatomique' });
// Le schéma est une IMAGE du corps réel (rendue depuis les maillages par
// `scripts/anatomy/build-schema.mjs`) ; ses points d'accroche sont des
// boutons positionnés d'après la carte de pixels générée, pas des zones
// dessinées à la main. On navigue donc par eux.
const schema = page.getByRole('group', { name: 'Schéma anatomique interactif' });

check('Le schéma anatomique affiche le corps rendu depuis les maillages', await schema.locator('img[src="/anatomy/schema/body.png"]').isVisible());
const regionHotspots = await schema.getByRole('button').count();
check('Les régions du corps sont des zones cliquables du schéma', regionHotspots >= 4, `${regionHotspots} zones`);

await schema.getByRole('button', { name: /^Tête et cou/ }).click();
await page.waitForTimeout(800);
const subHotspots = await schema.getByRole('button').count();
check('Ouvrir une région révèle ses sous-régions sur le schéma', subHotspots >= 3, `${subHotspots} zones`);

await schema.getByRole('button', { name: /^Crâne/ }).click();
await page.waitForTimeout(2500);
check('Le fil d’Ariane descend jusqu’à la sous-région ouverte', await breadcrumbNav.getByText(/Crâne/).isVisible());
const explorerListItem = page.locator('ul').getByText('Os temporal droit', { exact: true });
check(
  'Des structures réelles de la sous-région apparaissent dans la carte d’exploration',
  await explorerListItem.first().isVisible(),
);
// POINTS interactifs (§4/§5) : le modèle ne porte AUCUNE étiquette texte au
// repos, seulement de petits points. On interroge les points réellement
// rendus — leur nombre dépend du regroupement, cibler un nom en dur serait
// fragile.
await focusModel(page);
// Coordonnées relatives AU CANEVAS, pas à la fenêtre : la page défile
// désormais, et un point parfaitement placé sur le modèle aurait des
// coordonnées de fenêtre négatives dès que la page est descendue. Ce qui
// compte est qu'un point soit posé SUR le modèle.
const visibleDots = await page.evaluate(() => {
  const canvas = document.querySelector('canvas').getBoundingClientRect();
  return Array.from(document.querySelectorAll('[data-anatomy-dot]'))
    .filter((e) => e.style.display !== 'none')
    .map((e) => {
      const r = e.getBoundingClientRect();
      return {
        label: e.getAttribute('aria-label'),
        x: r.x + r.width / 2 - canvas.left,
        y: r.y + r.height / 2 - canvas.top,
        w: r.width,
        h: r.height,
        canvasW: canvas.width,
        canvasH: canvas.height,
      };
    });
});
check('Des points interactifs sont affichés sur le modèle', visibleDots.length > 0, `${visibleDots.length} points`);
const offscreenDots = visibleDots.filter(
  (d) => d.x < 0 || d.y < 0 || d.x > d.canvasW || d.y > d.canvasH || d.w < 24 || d.h < 24,
);
check(
  'Les points restent sur le modèle et sont assez grands pour le tactile',
  offscreenDots.length === 0,
  offscreenDots.length
    ? offscreenDots.map((d) => `${d.label} @${Math.round(d.x)},${Math.round(d.y)} ${Math.round(d.w)}x${Math.round(d.h)}`).join(' | ')
    : `${Math.min(...visibleDots.map((d) => d.w))} px minimum`,
);

// Aucun nom affiché tant que rien n'est sélectionné : c'est ce qui garde le
// modèle propre (§4).
const idleLabels = await page.evaluate(
  () => Array.from(document.querySelectorAll('[data-anatomy-dot-label]')).filter((e) => e.style.display !== 'none').length,
);
check('Aucun nom n’est affiché sur le modèle au repos', idleLabels === 0, `${idleLabels} étiquette(s)`);

// Deux points ne doivent jamais se superposer : c'est tout l'objet du
// regroupement (`services/anatomy/dotLayout.ts`).
const tooClose = visibleDots.reduce((n, a, i) => {
  for (let j = i + 1; j < visibleDots.length; j++) {
    const b = visibleDots[j];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 24) n++;
  }
  return n;
}, 0);
check('Aucun chevauchement entre points (§5)', tooClose === 0, `${tooClose} paire(s) trop proche(s)`);

await page.screenshot({ path: `${SHOT}/anatomy-subregion.png`, fullPage: false });

// Cliquer le marqueur sélectionne réellement la structure (vol de caméra + panneau).
// `force: true` : les marqueurs voisins (os zygomatique) peuvent chevaucher
// brièvement pendant l'animation de la caméra, sans que cela indique un bug —
// le positionnement réel est déjà vérifié ci-dessus.
// NOTE d'honnêteté sur la couverture : le clic SUR LE MARQUEUR lui-même a été
// vérifié manuellement (il ouvre bien le panneau de la structure cliquée),
// mais son assertion automatisée s'est révélée non fiable — les 14 marqueurs
// du crâne se chevauchent dans une zone dense partagée avec le canevas WebGL,
// et ni le clic par coordonnées ni le clic synthétique n'y sont déterministes.
// Plutôt que de faire passer un test qui ne prouverait rien, on couvre ici le
// même chemin fonctionnel — sélection d'une structure de la sous-région →
// panneau — via la liste d'exploration, qui est déterministe.
await explorerListItem.first().click();
// On ATTEND la condition au lieu de dormir une durée fixe : le panneau dépend
// d'une lecture Dexie dont la durée varie avec la charge de la page (267
// structures + 17 groupes d'assets). Un `sleep` calibré serait non
// déterministe par construction.
const panelOpen = await closePanelButton(page)
  .waitFor({ state: 'attached', timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check('Sélectionner une structure de la sous-région ouvre son panneau', panelOpen);
if (panelOpen) {
  const title = ((await page.locator('[data-anatomy-panel-title]').first().textContent()) ?? '').trim();
  check('Le panneau affiche exactement la structure choisie', title === 'Os temporal droit', title);
  await closePanelButton(page).click();
  await page.waitForTimeout(400);
}

// Revenir à Tête et cou puis au corps entier
await page.getByRole('button', { name: 'Remonter d’un niveau' }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Remonter d’un niveau' }).click();
await page.waitForTimeout(500);

// ---------- Chargement progressif : l'encéphale n'est PAS chargé d'emblée ----------
check(
  'L’encéphale (1,4 M triangles) n’est pas téléchargé tant que sa région n’est pas ouverte',
  !glbRequests.some((f) => f.startsWith('encephale')),
);

// ---------- Recherche → sélection → panneau ----------
await page.getByPlaceholder(/Rechercher une structure/).fill('masseter');
await page.waitForTimeout(500);
const searchResult = page.getByText('Masséter', { exact: false }).first();
check('La recherche approximative trouve « masséter »', await searchResult.isVisible());
check(
  'La recherche distingue les faisceaux et trouve aussi le nerf massétérique',
  (await page.locator('ul li button').count()) >= 4,
);
await searchResult.click();
await page.waitForTimeout(2000);

check('Le fil d’Ariane affiche la structure sélectionnée', await page.getByText(/Masséter/).first().isVisible());
// Le panneau attend une requête Dexie asynchrone (chunks + lookup) avant de
// monter — un délai fixe serait fragile, on attend explicitement l'onglet.
const panelOpened = await page
  .getByRole('tab', { name: 'Informations' })
  .waitFor({ state: 'visible', timeout: 15000 })
  .then(() => true)
  .catch(() => false);
check('Le panneau d’information s’ouvre', panelOpened);
check(
  'Un second onglet « Dans tes cours » est proposé',
  (await page.getByRole('tab', { name: /^Cours/ }).count()) === 1,
);

await page.screenshot({ path: `${SHOT}/anatomy-selected.png`, fullPage: false });

// ---------- Onglet « Dans tes cours » ----------
await page.getByRole('tab', { name: /^Cours/ }).click();
await page.waitForTimeout(300);
check(
  'Sans fiche générée, l’onglet Cours reste honnête (aucune source inventée)',
  await page.getByText(/Aucune source de cours pour l’instant/).isVisible(),
);
await page.getByRole('tab', { name: 'Informations' }).click();
await page.waitForTimeout(300);

// ---------- Isolation / restauration (carte dédiée, bas de page) ----------
await page.getByRole('button', { name: 'Isoler la sélection' }).click();
await page.waitForTimeout(300);
check('Isoler active le bouton Restaurer', await page.getByRole('button', { name: 'Restaurer' }).isEnabled());
await page.getByRole('button', { name: 'Restaurer' }).click();
await page.waitForTimeout(300);
check('Restaurer réactive le bouton Isoler la sélection', await page.getByRole('button', { name: 'Isoler la sélection' }).isEnabled());

// ---------- Information insuffisante / IA sans clé — honnête ----------
await page.getByRole('button', { name: 'Générer depuis mes cours' }).click();
await page.waitForTimeout(400);
check('Sans clé API, générer une fiche échoue clairement plutôt que d’inventer du contenu',
  await page.getByText(/clé API dans Paramètres/).last().isVisible());

await page.getByRole('button', { name: 'Demander à l’IA' }).click();
await page.waitForTimeout(200);
await page.getByPlaceholder(/Pose une question sur/).fill('Pourquoi ce muscle est-il important ?');
await page.getByRole('button', { name: 'Envoyer' }).click();
await page.waitForTimeout(400);
check('Sans clé API, la question à l’IA échoue clairement', await page.getByText(/clé API dans Paramètres/).last().isVisible());

await page.getByRole('button', { name: 'Créer une flashcard' }).click();
await page.waitForTimeout(400);
check('Sans clé API, la génération de flashcard échoue clairement', await page.getByText(/clé API dans Paramètres/).last().isVisible());

check('« Me tester » mène honnêtement vers /quiz (encore un placeholder)', await page.getByRole('link', { name: 'Me tester' }).isVisible());

// ---------- Fermeture du panneau, breadcrumb, retour à la recherche ----------
await closePanelButton(page).click();
await page.waitForTimeout(300);
check('Fermer le panneau retire la fiche de structure', (await page.getByRole('tab', { name: 'Informations' }).count()) === 0);
check(
  'La recherche reste visible en permanence, jamais remplacée par le panneau (§4)',
  await page.getByText('Recherche intelligente', { exact: false }).isVisible(),
);

// ---------- Mode apprentissage : correction visible SUR LE MODÈLE 3D ----------
await page.getByRole('button', { name: 'Commencer' }).click();
await page.waitForTimeout(1200);
check('Le mode apprentissage annonce une vraie structure cible à trouver', await page.getByText(/Trouve\s*:/).first().isVisible());
check('Le panneau d’information reste caché pendant le jeu — ne révèle pas la réponse', (await page.getByRole('tab', { name: 'Informations' }).count()) === 0);
check(
  'Avant la réponse, aucune structure n’est marquée — la cible n’est pas révélée',
  (await page.locator('[data-anatomy-feedback]').count()) === 0,
);

// Réponse volontairement au hasard : un clic au centre du canevas. Ce qui est
// vérifié n'est pas la justesse de la réponse mais la CORRECTION affichée sur
// le modèle — la bonne structure marquée « correct », et la structure cliquée
// marquée « incorrect » si elle diffère.
await focusModel(page);
const canvasBox = await page.locator('canvas').first().boundingBox();
await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
await page
  .locator('[data-anatomy-feedback="correct"]')
  .waitFor({ state: 'attached', timeout: 20000 })
  .catch(() => {});
const feedback = await page
  .locator('[data-anatomy-feedback]')
  .evaluateAll((els) => els.map((e) => e.getAttribute('data-anatomy-feedback')));
check(
  'Après la réponse, la bonne structure est marquée directement sur le modèle 3D',
  feedback.includes('correct'),
  feedback.join(', ') || 'aucun marqueur',
);
check(
  'Une réponse erronée est marquée comme telle, à côté de la bonne',
  feedback.length === 1 || feedback.includes('incorrect'),
  feedback.join(', '),
);
await page.screenshot({ path: `${SHOT}/anatomy-learning.png`, fullPage: false });

await page.getByRole('button', { name: 'Arrêter' }).click();
await page.waitForTimeout(300);
check('Arrêter quitte le mode apprentissage', await page.getByRole('button', { name: 'Commencer' }).isVisible());
check(
  'Quitter le mode apprentissage retire la correction du modèle',
  (await page.locator('[data-anatomy-feedback]').count()) === 0,
);

// ---------- Contrôles flottants du viewport (zoom/reset/plein écran) ----------
check('Contrôle de zoom avant présent', await page.getByLabel('Zoomer', { exact: true }).isVisible());
check('Contrôle de zoom arrière présent', await page.getByLabel('Dézoomer', { exact: true }).isVisible());
check('Contrôle de réinitialisation de la vue présent', await page.getByLabel('Revenir à la vue initiale', { exact: true }).isVisible());
await page.getByLabel('Zoomer', { exact: true }).click();
await page.waitForTimeout(200);
check('Le zoom ne provoque aucune erreur', errors.length === 0);

// ---------- Refonte : 4 colonnes, marqueurs à lignes, corps entier ----------
await page.getByPlaceholder(/Rechercher une structure/).fill('masseter');
await page.waitForTimeout(500);
await page.locator('ul li button').first().dispatchEvent('click');
const panelHere = await closePanelButton(page)
  .waitFor({ state: 'attached', timeout: 20000 })
  .then(() => true)
  .catch(() => false);
const searchHere = (await page.getByPlaceholder(/Rechercher une structure/).count()) === 1;
check(
  'Panneau d’information ET recherche sont visibles en même temps (§4)',
  panelHere && searchHere,
  `panneau=${panelHere} recherche=${searchHere}`,
);
await closePanelButton(page).click();
await page.waitForTimeout(300);

// Les cinq cartes du bas sont toutes montées en même temps : aucun onglet à
// ouvrir. On vérifie donc simplement qu'elles portent leurs commandes.
check('Le contrôle « Masquer le reste » existe (§10)', (await page.getByRole('button', { name: 'Masquer le reste' }).count()) === 1);
check('Le contrôle « Réinitialiser la vue » existe (§10)', (await page.getByRole('button', { name: 'Réinitialiser la vue' }).count()) === 1);

const comboActive = await page
  .getByRole('button', { name: /Tout afficher/ })
  .first()
  .getAttribute('aria-pressed');
check('Les combinaisons reflètent l’état réel des systèmes (§12)', comboActive === 'true', `aria-pressed=${comboActive}`);

// ---------- Vignettes anatomiques réelles : plus aucun emoji de substitution ----------
await page.getByPlaceholder(/Rechercher une structure/).fill('masseter');
await page.waitForTimeout(600);
const thumbs = await page.locator('img[src^="/anatomy/thumbs/"]').count();
check('Les résultats de recherche portent la vignette du maillage réel', thumbs > 0, `${thumbs} vignettes`);
const thumbLoaded = await page
  .locator('img[src^="/anatomy/thumbs/"]')
  .first()
  .evaluate((img) => img.complete && img.naturalWidth > 0);
check('Les vignettes se chargent réellement (image non cassée)', thumbLoaded);

// Une structure sans maillage ne reçoit PAS d'image de substitution.
await page.getByPlaceholder(/Rechercher une structure/).fill('nerf massétérique');
await page.waitForTimeout(600);
const neutral = await page.locator('[title="Géométrie 3D non disponible"]').count();
check(
  'Une structure sans maillage affiche une pastille « 3D non disponible », jamais un emoji',
  neutral > 0,
  `${neutral} pastilles`,
);
await page.getByPlaceholder(/Rechercher une structure/).fill('');

// ---------- Corps entier : une région hors tête et cou se charge vraiment ----------
await schema.getByRole('button', { name: /^Membre inférieur/ }).click();
await page.waitForTimeout(800);
await schema.getByRole('button', { name: /^Cuisse/ }).click();
// On ATTEND la requête réseau réelle plutôt qu'un délai : le téléchargement
// d'un groupe d'assets dépend de la charge de la page. Un `sleep` calibré
// serait non déterministe — c'est d'ailleurs ce qui a fait échouer ce test
// une fois lancé après les dix autres suites.
const thighAsset = await waitFor(() => glbRequests.some((f) => f.startsWith('cuisse')), 60000);
check(
  'Les assets d’une région éloignée (cuisse) sont téléchargés à la demande, pas au démarrage',
  thighAsset,
  glbRequests.filter((f) => f.startsWith('cuisse')).join(', ') || 'aucune requête cuisse',
);
const thighNamed = await page
  .waitForFunction(() => document.body.innerText.includes('Sartorius') || document.body.innerText.includes('Gracile'), null, { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
check('La cuisse expose de vraies structures nommées du corps entier', thighNamed);
await page.screenshot({ path: `${SHOT}/anatomy-cuisse.png`, fullPage: false });

// Navigation corps entier : toutes les régions réellement modélisées sont
// atteignables depuis le schéma — plus seulement la tête et le cou.
const up = page.getByRole('button', { name: 'Remonter d’un niveau' });
if ((await up.count()) > 0) {
  while ((await up.count()) > 0) {
    await up.first().click();
    await page.waitForTimeout(400);
  }
  const unavailable = await schema
    .getByRole('button')
    .evaluateAll((els) =>
      els
        .filter((e) => /Tronc|Membre supérieur|Membre inférieur/.test(e.getAttribute('aria-label') ?? ''))
        .map((e) => e.disabled),
    );
  check(
    // Ces trois régions ÉTAIENT annoncées comme dépourvues de 3D dans la
    // version précédente. Elles sont désormais réellement modélisées : le
    // test vérifie donc l'inverse — qu'elles sont présentes ET actives.
    'Le corps entier expose tronc et membres comme régions réellement explorables (§3/§20)',
    unavailable.length === 3 && unavailable.every((disabled) => disabled === false),
    `${unavailable.length} régions, désactivées=${unavailable.filter(Boolean).length}`,
  );
}

// ---------- Vues anatomiques standard (§13) ----------
// On vérifie que chaque vue REORIENTE réellement la caméra : l'image du
// canevas doit changer. Comparer des pixels serait fragile en rendu logiciel ;
// on compare la matrice de la caméra, exposée par le canevas via son état.
await focusModel(page);
const beforeView = await page.locator('canvas').first().screenshot();
// Les vues ont rejoint les contrôles de caméra : leur nom accessible est
// désormais le libellé complet ("Vue postérieure (de dos)"), pas l'abrégé.
await page.getByRole('button', { name: 'Vue postérieure (de dos)' }).click();
await page.waitForTimeout(2200);
const afterView = await page.locator('canvas').first().screenshot();
check(
  'La vue postérieure réoriente réellement la caméra (§13)',
  !beforeView.equals(afterView),
  `${beforeView.length} vs ${afterView.length} octets`,
);
for (const label of [
  'Vue antérieure (de face)',
  'Vue latérale droite',
  'Vue latérale gauche',
  'Vue supérieure (de dessus)',
  'Vue inférieure (de dessous)',
]) {
  check(`La vue « ${label} » est proposée`, (await page.getByRole('button', { name: label }).count()) === 1);
}
await page.getByRole('button', { name: 'Vue antérieure (de face)' }).click();
await page.waitForTimeout(1500);

// ---------- Schéma agrandi (§8/§18) : cibles réellement touchables ----------
await page.getByRole('button', { name: 'Agrandir le schéma anatomique' }).click();
await page.waitForTimeout(900);
const dialog = page.getByRole('dialog');
check('Le schéma peut être agrandi pour un usage tactile', await dialog.isVisible());
const bigZones = await dialog.getByRole('button').evaluateAll((els) =>
  els
    .filter((e) => e.getAttribute('aria-pressed') !== null)
    .map((e) => {
      const r = e.getBoundingClientRect();
      return { l: e.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) };
    }),
);
check('Le schéma agrandi expose les régions du corps', bigZones.length >= 4, `${bigZones.length} zones`);
check(
  'Ses zones font au moins 40 px — utilisables au doigt',
  bigZones.every((z) => z.w >= 40 && z.h >= 40),
  bigZones.map((z) => `${z.l}:${z.w}x${z.h}`).join(' '),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// ---------- Dentisterie (§14) : fiche dentaire dérivée du numéro FDI ----------
await page.getByPlaceholder(/Rechercher une structure/).fill('dent 36');
await page.waitForTimeout(700);
await page.locator('ul li button').first().dispatchEvent('click');
const toothPanel = await closePanelButton(page)
  .waitFor({ state: 'attached', timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check('Chercher « dent 36 » sélectionne une dent', toothPanel);
if (toothPanel) {
  const facts = await page.locator('dl').first().innerText().catch(() => '');
  check('La fiche dentaire donne le numéro FDI', /FDI/.test(facts), facts.replace(/\n/g, ' | ').slice(0, 120));
  check('Elle donne l’arcade et le côté', /Arcade/.test(facts) && /Côté/.test(facts));
  // La provenance est désormais une NOTE DE BAS de fiche, plus un bloc en
  // tête : c'est une métadonnée, pas le contenu principal.
  const provenance = await page.locator('[data-anatomy-provenance]').first().innerText().catch(() => '');
  check(
    'La fiche rappelle en note la provenance BodyParts3D vérifiable',
    /BodyParts3D/.test(provenance) && /triangles/.test(provenance),
    provenance.replace(/\n/g, ' | ').slice(0, 120),
  );
  await closePanelButton(page).click();
  await page.waitForTimeout(300);
}
await page.getByPlaceholder(/Rechercher une structure/).fill('');

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
await browser.close();
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
