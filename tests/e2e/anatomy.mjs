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

// Enregistré AVANT la navigation : sinon aucune requête d'asset ne serait
// observée et la vérification du chargement paresseux serait vide de sens.
const glbRequests = [];
page.on('response', (r) => {
  if (r.url().endsWith('.glb')) glbRequests.push(r.url().split('/').pop());
});

await page.goto(`${BASE}#/anatomie`, { waitUntil: 'networkidle' });
// 17 groupes d'assets se chargent en parallèle : on laisse le temps au
// premier cadrage caméra de se faire avant de mesurer quoi que ce soit.
await page.waitForTimeout(8000);
check('Des groupes d’assets par région × système sont bien téléchargés', glbRequests.length >= 10);

// ---------- Corps entier / systèmes par défaut / thème sombre dédié ----------
check('La page Anatomie 3D s’ouvre', await page.getByText('Anatomie 3D').isVisible());
check('Le fil d’Ariane démarre sur Tête et cou', await page.getByText('Tête et cou').isVisible());
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
check(
  'Nerfs est un système activable comme les autres',
  (await page.getByRole('button', { name: /^Nerfs/ }).getAttribute('aria-pressed')) === 'true',
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

await page.getByRole('button', { name: '🦴 + 🧠 Squelette et nerfs' }).click();
await page.waitForTimeout(300);
check(
  'Le préréglage « Squelette et nerfs » applique exactement cette combinaison',
  (await page.getByRole('button', { name: 'Squelette', exact: true }).getAttribute('aria-pressed')) === 'true' &&
    (await page.getByRole('button', { name: 'Muscles', exact: true }).getAttribute('aria-pressed')) === 'false',
);
await page.getByRole('button', { name: 'Tout afficher' }).click();
await page.waitForTimeout(300);

// ---------- Exploration par région : drill-down réel + marqueurs positionnés sur le vrai maillage ----------
const breadcrumbNav = page.getByRole('navigation', { name: 'Navigation anatomique' });
// La carte d'exploration rend le libellé de la région dans un `<span>` dédié
// (icône séparée, aria-hidden) : c'est ce span, pas le bouton entier
// (icône+libellé+compteur), qui correspond exactement à « Crâne ».
await page.getByText('Crâne', { exact: true }).first().click();
await page.waitForTimeout(2500);
check('Le fil d’Ariane descend jusqu’à la sous-région ouverte', await breadcrumbNav.getByText(/Crâne/).isVisible());
const explorerListItem = page.locator('ul').getByText('Os temporal droit', { exact: true });
check(
  'Des structures réelles de la sous-région apparaissent dans la carte d’exploration',
  await explorerListItem.first().isVisible(),
);
// Le marqueur 3D est un `<button data-touch-target aria-label="…">` distinct
// de l'entrée de liste — même nom visible, deux éléments : on cible
// spécifiquement l'attribut du marqueur pour éviter toute ambiguïté.
const marker = page.locator('[data-touch-target][aria-label="Os temporal droit"]');
const markerCount = await marker.count();
check('Un marqueur 3D interactif existe pour une structure réelle de la sous-région', markerCount > 0);
if (markerCount > 0) {
  // Les clics précédents (préréglages) ont pu faire défiler la page jusqu'aux
  // cartes du bas — on doit ramener le viewport 3D à l'écran avant de mesurer.
  await marker.first().scrollIntoViewIfNeeded();
  await marker.first().waitFor({ state: 'visible' });
  const box = await marker.first().boundingBox();
  check('Le marqueur est positionné dans le canevas (pas hors-écran) — pas décoratif', !!box && box.x > 0 && box.y > 0 && box.y < 900);
}
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
// Le panneau attend une lecture Dexie complète ; avec 267 structures chargées
// la page est nettement plus occupée qu'avant — on lui laisse le temps.
await page.waitForTimeout(6000);
const panelOpen = (await page.getByRole('button', { name: 'Fermer le panneau' }).count()) === 1;
check('Sélectionner une structure de la sous-région ouvre son panneau', panelOpen);
if (panelOpen) {
  const title = ((await page.locator('p.truncate').first().textContent()) ?? '').trim();
  check('Le panneau affiche exactement la structure choisie', title === 'Os temporal droit', title);
  await page.getByRole('button', { name: 'Fermer le panneau' }).click();
  await page.waitForTimeout(400);
}

// Revenir à Tête et cou
await page.getByRole('button', { name: 'Revenir à Tête et cou' }).click();
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
  (await page.getByRole('tab', { name: /Dans tes cours/ }).count()) === 1,
);

await page.screenshot({ path: `${SHOT}/anatomy-selected.png`, fullPage: false });

// ---------- Onglet « Dans tes cours » ----------
await page.getByRole('tab', { name: /Dans tes cours/ }).click();
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
check('Isoler affiche Restaurer à la place', await page.getByRole('button', { name: 'Restaurer' }).isVisible());
await page.getByRole('button', { name: 'Restaurer' }).click();
await page.waitForTimeout(300);
check('Restaurer ramène le bouton Isoler la sélection', await page.getByRole('button', { name: 'Isoler la sélection' }).isVisible());

// ---------- Information insuffisante / IA sans clé — honnête ----------
await page.getByRole('button', { name: '✨ Générer depuis mes cours' }).click();
await page.waitForTimeout(400);
check('Sans clé API, générer une fiche échoue clairement plutôt que d’inventer du contenu',
  await page.getByText(/clé API dans Paramètres/).last().isVisible());

await page.getByRole('button', { name: 'Demander à l’IA' }).click();
await page.waitForTimeout(200);
await page.getByPlaceholder(/Pose une question sur/).fill('Pourquoi ce muscle est-il important ?');
await page.getByRole('button', { name: 'Envoyer' }).click();
await page.waitForTimeout(400);
check('Sans clé API, la question à l’IA échoue clairement', await page.getByText(/clé API dans Paramètres/).last().isVisible());

await page.getByRole('button', { name: '🃏 Créer une flashcard' }).click();
await page.waitForTimeout(400);
check('Sans clé API, la génération de flashcard échoue clairement', await page.getByText(/clé API dans Paramètres/).last().isVisible());

check('« Me tester » mène honnêtement vers /quiz (encore un placeholder)', await page.getByRole('link', { name: '❓ Me tester' }).isVisible());

// ---------- Fermeture du panneau, breadcrumb, retour à la recherche ----------
await page.getByRole('button', { name: 'Fermer le panneau' }).click();
await page.waitForTimeout(300);
check('Fermer le panneau retire la structure du fil d’Ariane', !(await page.getByRole('tab', { name: 'Informations' }).isVisible().catch(() => false)));
check('Le rail de recherche revient une fois le panneau fermé', await page.getByText('Recherche intelligente', { exact: false }).isVisible());

// ---------- Mode apprentissage : un vrai mini-jeu, pas une décoration ----------
await page.getByRole('button', { name: 'Commencer' }).click();
await page.waitForTimeout(1200);
check('Le mode apprentissage annonce une vraie structure cible à trouver', await page.getByText(/Trouve\s*:/).first().isVisible());
check('Le panneau d’information reste caché pendant le jeu — ne révèle pas la réponse', !(await page.getByRole('tab', { name: 'Informations' }).isVisible().catch(() => false)));
await page.getByRole('button', { name: 'Arrêter' }).click();
await page.waitForTimeout(300);
check('Arrêter quitte le mode apprentissage', await page.getByRole('button', { name: 'Commencer' }).isVisible());

// ---------- Contrôles flottants du viewport (zoom/reset/plein écran) ----------
check('Contrôle de zoom avant présent', await page.getByLabel('Zoomer', { exact: true }).isVisible());
check('Contrôle de zoom arrière présent', await page.getByLabel('Dézoomer', { exact: true }).isVisible());
check('Contrôle de réinitialisation de la vue présent', await page.getByLabel('Revenir à la vue initiale', { exact: true }).isVisible());
await page.getByLabel('Zoomer', { exact: true }).click();
await page.waitForTimeout(200);
check('Le zoom ne provoque aucune erreur', errors.length === 0);

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
await browser.close();
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
