import { chromium, devices } from 'playwright';

/**
 * Parcours réel : créer une matière, un chapitre, importer un document par
 * collage, vérifier qu'il est indexé pour l'IA, puis contrôler que
 * l'assistant répond honnêtement à une question que le moteur local ne peut
 * pas couvrir avec assez de confiance — jamais un échec silencieux ni une
 * invention, et jamais besoin de clé API pour l'obtenir.
 *
 * Prérequis : `npm run build` puis `npm run preview`.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:4173/Musab-Study/';
const results = [];
const errors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const COURSE_TEXT =
  "Le muscle masséter est un muscle masticateur puissant et superficiel. Il s'insère en haut sur l'arcade zygomatique et en bas sur la face latérale de l'angle de la mandibule. Son innervation motrice est assurée par le nerf massétérique, branche du nerf mandibulaire V3, lui-même issu du nerf trijumeau. Sa contraction élève la mandibule et participe à la mastication. ".repeat(3);

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ ...devices['iPad Pro 11'] });
const page = await context.newPage();
// La navigation contient elle aussi « Cours » et « Anatomie » : on cible le
// contenu principal pour lever toute ambiguïté.
const main = page.locator('main');
const nav = page.locator('aside, nav.fixed');
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });

// ---------- Créer une matière ----------
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(500);
check('L’écran Cours propose de créer une matière',
  await page.getByRole('button', { name: 'Créer ma première matière' }).isVisible());

await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Nom').fill('Anatomie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(600);
check('La matière apparaît dans la liste',
  await main.getByRole('heading', { name: 'Anatomie' }).isVisible());

// ---------- Chapitre ----------
await main.getByRole('link', { name: /Anatomie/ }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(400);
await page.getByLabel('Nom du chapitre').fill('Muscles masticateurs');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(600);
check('Le chapitre est créé et ouvert',
  await page.getByRole('heading', { name: 'Muscles masticateurs' }).isVisible());

// ---------- Document ----------
await page.getByRole('button', { name: 'Ajouter un document' }).click();
await page.waitForTimeout(500);
await page.getByLabel('Nom du document').fill('Masséter');

const saveButton = page.getByRole('button', { name: 'Enregistrer le document' });
check('Le bouton d’enregistrement est bloqué tant que le texte est trop court',
  await saveButton.isDisabled());

await page.getByLabel('Texte du document').fill(COURSE_TEXT);
await page.waitForTimeout(300);
check('Le bouton s’active avec un texte suffisant', await saveButton.isEnabled());

await saveButton.click();
await page.waitForTimeout(800);
check('Notification d’indexation affichée',
  await page.getByText(/indexé pour l’IA/).isVisible());

await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('Le document apparaît dans le chapitre',
  await main.getByText('Masséter', { exact: false }).first().isVisible());

// ---------- Vérifie l'indexation RAG directement en base ----------
const indexed = await page.evaluate(async () => {
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
  const [documents, chunks] = await Promise.all([readAll('documents'), readAll('chunks')]);
  return {
    documents: documents.length,
    chunks: chunks.length,
    hasTermFreq: chunks.every((c) => c.termFreq && Object.keys(c.termFreq).length > 0),
    findsMasseter: chunks.some((c) => c.termFreq?.masseter > 0),
    findsV3: chunks.some((c) => c.termFreq?.v3 > 0),
  };
});

check('Le document est enregistré', indexed.documents === 1);
check('Le document est découpé en fragments', indexed.chunks > 0, `${indexed.chunks} fragments`);
check('Chaque fragment porte ses fréquences de termes', indexed.hasTermFreq);
check('Les accents sont normalisés à l’indexation (masséter → masseter)', indexed.findsMasseter);
check('Les termes courts de nomenclature sont indexés (V3)', indexed.findsV3);

// ---------- Compteurs de la liste ----------
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(600);
/*
 * Les compteurs s'écrivent maintenant comme on les dirait (« 1 document », pas
 * « 1 document(s) »), et un compteur à ZÉRO n'est plus affiché du tout : sur
 * une matière qu'on vient de créer, « 0 carte(s) 0 note(s) » occupait les
 * trois quarts de la ligne sans rien apprendre.
 */
const counters = await page.locator('main a[href*="/cours/"]').first().innerText();
check('Les compteurs de la matière sont à jour', counters.includes('1 document'), counters.replace(/\n/g, ' · '));
check('Aucun compteur à zéro n’encombre la ligne', !/\b0 (carte|note|chapitre|document)/.test(counters));

// ---------- Assistant IA sans clé ----------
await nav.getByRole('link', { name: 'IA', exact: true }).first().click();
await page.waitForTimeout(700);
check('L’assistant s’ouvre sur la matière importée',
  await page.getByRole('heading', { name: 'IA', exact: true }).isVisible());

/*
 * ── UNE QUESTION À LAQUELLE LE COURS RÉPOND ──
 *
 * Le cours importé dit : « Son innervation motrice est assurée par le nerf
 * massétérique ». Cette vérification attendait auparavant le message
 * d'abstention — elle figeait donc le DÉFAUT : le moteur ne savait répondre
 * que si une règle « X est Y » avait matché, et se déclarait incompétent sur
 * une question dont la réponse était écrite noir sur blanc. Mesuré sur un vrai
 * polycopié, ça donnait huit « Absent de tes cours » sur huit questions.
 */
await page.getByPlaceholder(/question sur tes cours/).fill('Innervation du masséter ?');
await page.getByRole('button', { name: 'Envoyer' }).click();
await page.waitForTimeout(1200);
// Le terme n'apparaît nulle part ailleurs sur cet écran : le voir, c'est que
// la réponse vient bien du cours.
check(
  'Une question à laquelle le cours répond obtient bien la réponse du cours',
  await page.getByText(/nerf massétérique/i).first().isVisible(),
);
check(
  'La réponse est citée du cours, jamais inventée — la provenance le dit',
  await page.getByText(/aucun appel IA|tes cours/).first().isVisible(),
);

/*
 * ── UNE QUESTION HORS DU COURS ──
 *
 * L'abstention reste entière, et c'est elle qui garantit qu'aucune réponse
 * n'est inventée : sur un sujet absent du document, l'application le DIT.
 *
 * Il existe deux chemins d'abstention, et celui-ci est le plus strict : quand
 * la recherche ne remonte AUCUN passage, aucun bouton « Répondre avec l'IA »
 * n'est proposé — délibérément. Sans le moindre extrait à citer, une réponse
 * d'IA ne serait fondée sur rien, et l'application ne propose pas une option
 * qu'elle sait mauvaise. L'IA reste accessible, mais par un choix explicite
 * de l'utilisateur dans le sélecteur d'assistant.
 */
await page.getByPlaceholder(/question sur tes cours/).fill('Explique-moi la vascularisation du foie');
await page.getByRole('button', { name: 'Envoyer' }).click();
await page.waitForTimeout(1200);
check('Sur un sujet absent du cours, un message honnête est affiché — jamais un échec silencieux, jamais d’invention',
  await page.getByText(/Aucun passage de tes cours ne correspond/).isVisible());
check('Rien n’est inventé pour combler le vide — la provenance l’annonce',
  await page.getByText('Absent de tes cours').first().isVisible());
check('L’IA reste un choix explicite de l’utilisateur, jamais déclenchée d’office',
  await page.locator('[data-ai-assistant]').isVisible());

await page.screenshot({
  path: `${process.env.SCREENSHOT_DIR ?? './dist-screenshots'}/ipad-cours.png`,
  fullPage: false,
});

await browser.close();

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
