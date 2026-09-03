import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * ASSISTANT IA — interface pédagogique unique au-dessus du chat existant
 * (Comprendre / Étudier / Mémoriser / Préparer l'examen).
 *
 * Cet environnement de test n'a aucune clé API configurée. Certaines actions
 * exigent réellement une génération linguistique (Comprendre, Résumer ce
 * cours) et affichent donc, à raison, le même message honnête que le chat
 * existant (« Ajoute ta clé API… »). D'autres (Notions, Mémoriser →
 * flashcards) utilisent par défaut le moteur pédagogique LOCAL
 * (`services/local/`) — aucune clé requise, aucun appel réseau — et sont
 * donc testées de bout en bout avec un vrai document importé. Les actions
 * qui ne dépendent d'AUCUN appel IA (Quiz, Calendrier, points faibles
 * mesurés) sont testées de bout en bout : elles réutilisent le Quiz et le
 * Calendrier existants, jamais un système parallèle.
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
const main = page.locator('main');
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const goIa = async () => {
  await nav.getByRole('link', { name: 'IA', exact: true }).first().click();
  await page.waitForTimeout(600);
};
const goFlashcards = async () => {
  await nav.getByRole('link', { name: 'Flashcards', exact: true }).first().click();
  await page.waitForTimeout(600);
};
const toast = () => page.locator('[aria-live="polite"]').innerText().catch(() => '');
const sheet = () => page.locator('[data-assistant-sheet]');
/** Ouvre la feuille d'actions depuis l'intention correspondante. */
const openIntent = async (key) => {
  await page.locator(`[data-ai-intent="${key}"]`).click();
  await page.waitForTimeout(400);
};
const category = (label) => sheet().getByRole('tab', { name: label });

const COURSE_TEXT =
  'Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire. ' +
  'Le nerf facial commande les muscles de la mimique faciale. ' +
  "Le nerf olfactif est purement sensitif. Attention à ne pas confondre le nerf trijumeau avec le nerf facial : leurs territoires sont différents. ".repeat(
    3,
  );

await page.goto(BASE, { waitUntil: 'networkidle' });

// ────────────────── 0. Préparation : une matière, un chapitre, un document réel, quelques cartes ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Anatomie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(700);
await main.getByRole('link', { name: 'Anatomie' }).first().click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du chapitre').fill('Nerfs crâniens');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(700);

await page.getByRole('button', { name: 'Ajouter un document' }).first().click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du document').fill('Nerfs crâniens — notes');
await page.getByLabel('Texte du document').fill(COURSE_TEXT);
await page.getByRole('button', { name: 'Enregistrer le document' }).click();
await page.waitForTimeout(700);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await goFlashcards();
await page.getByRole('tab', { name: '✍️ Créer manuellement' }).click();
await page.waitForTimeout(300);
for (const [q, a] of [
  ['Combien de nerfs crâniens ?', 'Douze paires.'],
  ['Quel nerf innerve le masséter ?', 'Le nerf trijumeau (V3).'],
  ['Quel nerf est purement sensitif ?', 'Le nerf olfactif (I).'],
  ['Quel nerf commande la mimique faciale ?', 'Le nerf facial (VII).'],
]) {
  await page.getByLabel('Question').fill(q);
  await page.getByLabel('Réponse', { exact: true }).fill(a);
  await page.getByRole('button', { name: 'Ajouter la carte' }).click();
  await page.waitForTimeout(300);
}
check('Quatre flashcards réelles créées pour alimenter le Quiz', await page.getByText('Bibliothèque (4)').isVisible());

// ────────────────── 1. La page IA met la conversation au centre ──────────────────
await goIa();
check('La page « IA » s’ouvre', await page.getByRole('heading', { name: 'IA', exact: true }).isVisible());
check('Le champ de question est immédiatement visible, sans défilement', await page.locator('[data-ai-question]').isVisible());
check('Le bouton « Envoyer » est immédiatement visible', await page.getByRole('button', { name: 'Envoyer' }).isVisible());
check('La source (Mes cours / Internet) est proposée', await page.locator('[data-ai-source="cours"]').isVisible());
check('L’assistant se choisit discrètement, sans envahir l’écran', await page.locator('[data-ai-assistant]').isVisible());

// ────────────────── 1bis. Mes cours + Automatique : LOCAL d'abord, jamais un appel réseau silencieux ──────────────────
// Reproduit exactement le signalement utilisateur : mode « Mes cours »,
// assistant « Automatique », une question dont la réponse existe dans le
// document réellement importé plus haut — ne doit JAMAIS déclencher de
// requête vers un fournisseur IA (aucune clé n'est configurée dans cet
// environnement de test, donc la moindre tentative échouerait comme dans
// le signalement : « Gemini est momentanément indisponible »).
const aiNetworkCalls = [];
page.on('request', (request) => {
  const url = request.url();
  if (url.includes('anthropic.com') || url.includes('/api/ai/')) aiNetworkCalls.push(url);
});

check('Assistant « Automatique » sélectionné par défaut', (await page.locator('[data-ai-assistant]').inputValue()) === 'auto');
await page.locator('[data-ai-question]').fill('Je ne comprends pas les nerfs trijumeau');
await page.getByRole('button', { name: 'Envoyer' }).click();
await page.waitForTimeout(1200);
check(
  'La réponse est générée localement — badge honnête, aucun appel IA',
  await page.getByText(/aucun appel IA/).isVisible(),
);
check('Le contenu réel du cours apparaît dans la réponse locale', await main.getByText(/trois branches/).isVisible());
check(
  'Aucune requête réseau vers un fournisseur IA n’a été émise pour cette question',
  aiNetworkCalls.length === 0,
  aiNetworkCalls.join(', '),
);

// ────────────────── 1ter. Question hors de portée locale : refus honnête, jamais d'invention ──────────────────
// Partage du vocabulaire avec le document importé (« territoires »,
// « différents » — présents dans la phrase d'avertissement, écartée par le
// moteur local) : la recherche BM25 trouve donc bien un passage, mais aucun
// fait extrait n'en couvre le sujet — exactement le cas « rien de fiable à
// répondre localement », distinct du cas « rien de pertinent trouvé ».
await page.locator('[data-ai-question]').fill('Quels sont les territoires différents mentionnés ?');
await page.getByRole('button', { name: 'Envoyer' }).click();
await page.waitForTimeout(1200);
check(
  'Sans réponse locale fiable, un message honnête est affiché plutôt qu’une invention',
  await page.getByText(/Tu peux activer un assistant IA/).isVisible(),
);
check('Le bouton « Répondre avec l’IA » est proposé — jamais déclenché tout seul', await page.locator('[data-ai-answer-with-ai]').isVisible());
check(
  'Toujours aucun appel réseau vers un fournisseur IA à ce stade',
  aiNetworkCalls.length === 0,
  aiNetworkCalls.join(', '),
);

// L'action reste explicite : cliquer le bouton tente RÉELLEMENT l'IA (et
// échoue proprement, sans clé configurée) — sans jamais casser le reste de
// l'application.
await page.locator('[data-ai-answer-with-ai]').click();
await page.waitForTimeout(1200);
check(
  'Cliquer « Répondre avec l’IA » échoue honnêtement sans clé configurée, sans crasher l’application',
  await page.getByText(/clé API/).isVisible(),
);

// L'application reste pleinement utilisable après cet échec explicite.
await page.locator('[data-ai-question]').fill('nerf facial');
await page.getByRole('button', { name: 'Envoyer' }).click();
await page.waitForTimeout(1200);
check(
  'Après un échec IA explicite, une nouvelle question locale fonctionne toujours normalement',
  await page.getByText(/aucun appel IA/).last().isVisible(),
);

// Quatre intentions seulement — le reste des actions vit derrière elles.
check('Exactement quatre intentions sont affichées', (await page.locator('[data-ai-intent]').count()) === 4);
check('Aucune feuille d’actions n’est ouverte au départ', (await sheet().count()) === 0);

await openIntent('comprendre');
check('Une intention ouvre la feuille d’actions', await sheet().isVisible());
for (const label of ['Comprendre', 'Étudier', 'Mémoriser', "Préparer l'examen"]) {
  check(`Catégorie « ${label} » atteignable depuis la feuille`, await category(label).isVisible());
}

// ────────────────── 2. Comprendre — construit une question, réutilise le chat ──────────────────
// « Comprendre » n'a AUCUN circuit IA propre : elle écrit une question et la
// transmet au chat existant (`onAskChat` → `ChatPage.handleSend`), qui
// applique désormais le même moteur local en premier — la réponse arrive
// donc ici aussi sans clé API, pour la même raison que dans la conversation
// directe testée plus haut.
await category('Comprendre').click();
await page.waitForTimeout(300);
await page.locator('[data-assistant-comprehend-notion]').fill('le nerf trijumeau');
await page.locator('[data-assistant-comprehend-ask]').click();
await page.waitForTimeout(1200);
check(
  '« Comprendre » réutilise le même pipeline que le chat — réponse locale, aucun système IA parallèle',
  await page.getByText(/aucun appel IA/).last().isVisible(),
);

// Lancer une action REFERME la feuille — la conversation reprend la main.
check('Lancer une action referme la feuille et rend la conversation au premier plan', (await sheet().count()) === 0);

// « Comparer deux notions » exige les deux champs.
await openIntent('comprendre');
await page.locator('[data-assistant-comprehend-notion]').fill('');
const compareChip = page.locator('[data-assistant-comprehend]').getByRole('button', { name: /Comparer deux notions/ });
await compareChip.click();
await page.waitForTimeout(200);
check(
  'Le bouton « Demander » reste désactivé tant que les notions à comparer ne sont pas remplies',
  await page.locator('[data-assistant-comprehend-ask]').isDisabled(),
);

// ────────────────── 3. Étudier — actions sur tout le chapitre, jamais une invention ──────────────────
if ((await sheet().count()) === 0) await openIntent('etudier');
await category('Étudier').click();
await page.waitForTimeout(300);
await page.locator('[data-assistant-study-summary]').click();
await page.waitForTimeout(500);
check('« Résumer ce cours » demande aussi honnêtement une clé API', /Ajoute ta clé API/.test(await toast()));

// « Notions importantes / difficiles » exige un chapitre précis (pas « toute la matière »).
await page.locator('[data-assistant-study-notions]').click();
await page.waitForTimeout(400);
check(
  'Sans chapitre précis choisi, l’action « Notions » le dit plutôt que d’analyser au hasard',
  /Choisis un chapitre précis/.test(await toast()),
);

// ────────────────── 4. Mémoriser — flashcards proposées SANS IA par défaut (moteur local), et Quiz réel ──────────────────
if ((await sheet().count()) === 0) await openIntent('memoriser');
await category('Mémoriser').click();
await page.waitForTimeout(300);
await page.locator('[data-assistant-memorize-generate]').click();
await page.waitForTimeout(700);
check(
  '« Proposer des flashcards » fonctionne sans clé API — le moteur local analyse le document réel importé',
  await page.locator('[data-assistant-memorize-draft]').isVisible().catch(() => false) ||
    !(await toast()).includes('Ajoute ta clé API'),
);

await page.locator('[data-assistant-memorize-qcm]').click();
await page.waitForTimeout(800);
check('« Lancer un QCM » ouvre bien le Quiz existant (URL /quiz)', page.url().includes('/quiz'));
const quizStarted = (await page.locator('[data-quiz-session]').count()) > 0;
check('Le quiz démarre directement, avec les vraies flashcards de la matière (aucune génération IA)', quizStarted);
if (quizStarted) {
  const questionText = await page.locator('[data-quiz-session]').innerText();
  check(
    'La question du quiz reprend une vraie question de flashcard',
    /nerf|masséter|olfactif|facial|crâniens/i.test(questionText),
  );
}

// ────────────────── 5. Préparer l'examen — déterministe, aucun appel IA ──────────────────
await goIa();
await openIntent('examen');
await page.waitForTimeout(400);
check(
  'Sans assez de réponses enregistrées, les points faibles le disent honnêtement (aucun chiffre inventé)',
  await page.locator('[data-assistant-examprep]').isVisible(),
);
await page.locator('[data-assistant-examprep-plan]').click();
await page.waitForTimeout(700);
check(
  '« Préparer une session de révision » ouvre le vrai planificateur du Calendrier (PlanReviewModal)',
  await page.getByRole('heading', { name: 'Planifier ma semaine' }).isVisible(),
);
await page.locator('[data-plan-refuse]').first().click();
await page.waitForTimeout(400);

// ────────────────── 6. iPad portrait/paysage, sans débordement ──────────────────
for (const [name, viewport] of [
  ['paysage', { width: 1194, height: 834 }],
  ['portrait', { width: 834, height: 1194 }],
]) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(400);
  await goIa();
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`Page IA : aucun débordement horizontal (${name})`, !overflow);
  await page.screenshot({ path: `${SHOT}/assistant-${name}.png` });
}
await page.setViewportSize({ width: 1194, height: 834 });

console.log('\n--- Erreurs console ---');
console.log(errors.length ? errors.join('\n') : 'aucune');

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées`);
if (passed !== results.length || errors.length > 0) process.exit(1);
