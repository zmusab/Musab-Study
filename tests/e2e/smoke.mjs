import { mkdir } from 'node:fs/promises';
import { chromium, devices } from 'playwright';

/**
 * Test de bout en bout sur navigateur réel.
 *
 * Il vérifie ce qu'aucun test unitaire ne peut voir : que l'application démarre
 * vraiment, que les données survivent à un rechargement, que rien ne déborde
 * horizontalement sur iPad et iPhone, que les cibles tactiles respectent les
 * 44 px d'Apple, que les champs ne déclenchent pas le zoom d'iOS, et que
 * l'application reste utilisable quand les animations sont désactivées.
 *
 * Prérequis : `npm run build` puis `npm run preview` dans un autre terminal.
 * Lancement : `npm run test:e2e`
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:4173/Musab-Study/';
const SHOT = process.env.SCREENSHOT_DIR ?? './dist-screenshots';
await mkdir(SHOT, { recursive: true });

const errors = [];
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// `CHROMIUM_PATH` permet d'utiliser un Chromium déjà présent sur la machine
// plutôt que d'en télécharger un second.
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);

// ---------- iPad Pro ----------
const ipad = await browser.newContext({ ...devices['iPad Pro 11'] });
const page = await ipad.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[ipad] ${m.text()}`); });
page.on('requestfailed', (r) => errors.push(`[ipad] requete echouee: ${r.url()}`));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`[ipad] HTTP ${r.status()}: ${r.url()}`); });
page.on('pageerror', (e) => errors.push(`[ipad] pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });

check('L’application démarre', await page.locator('#root').count() === 1);
check('Le titre est rendu', (await page.locator('h1').first().textContent())?.includes('Musab Study'));

// Navigation
await page.getByRole('link', { name: /Paramètres/ }).first().click();
await page.waitForTimeout(600);
check('Navigation vers Paramètres', await page.getByRole('heading', { name: 'Paramètres' }).isVisible());
check('L’URL utilise le hash', page.url().includes('#/parametres'), page.url().split('#')[1]);

// Champs 16px (anti-zoom iOS)
const fontSize = await page.locator('input[type="text"], input:not([type])').first()
  .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check('Champs ≥ 16px (pas de zoom iOS)', fontSize >= 16, `${fontSize}px`);

// Enregistrement du profil -> persistance IndexedDB
const nameInput = page.getByLabel('Prénom');
await nameInput.fill('Musab');
await page.getByRole('button', { name: 'Enregistrer le profil' }).click();
await page.waitForTimeout(500);
check('Notification affichée (remplace alert)', await page.getByText('Profil enregistré.').isVisible());

const sidebarBefore = await page.locator('aside p').first().textContent();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const persisted = await page.getByLabel('Prénom').inputValue();
check('Le profil persiste après rechargement (IndexedDB)', persisted === 'Musab', `"${persisted}"`);

// Thème
await page.getByRole('tab', { name: /Sombre/ }).click();
await page.waitForTimeout(400);
const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
check('Bascule en mode sombre', theme === 'dark', theme ?? 'null');
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
/*
 * On vérifie que le fond est RÉELLEMENT sombre, pas qu'il vaut un hexadécimal
 * précis. La version précédente figeait `rgb(22, 19, 15)` : le moindre réglage
 * de la palette — un fond remonté de trois points pour que le quadrillage du
 * papier reste visible — cassait un test qui ne parle pas de palette mais de
 * bascule de thème. On mesure donc ce qui compte : très sombre, et chaud
 * (rouge ≥ bleu), jamais le bleu-noir de tableau de bord d'origine.
 */
const rgb = (bg.match(/\d+/g) ?? []).map(Number);
const [red = 0, green = 0, blue = 0] = rgb;
check(
  'Le fond suit le thème sombre — sombre et chaud',
  red < 60 && green < 60 && blue < 60 && red >= blue,
  bg,
);

await page.screenshot({ path: `${SHOT}/ipad-dark-settings.png`, fullPage: false });

await page.getByRole('tab', { name: /Clair/ }).click();
await page.waitForTimeout(400);

// Confirmation modale (remplace window.confirm)
await page.getByRole('button', { name: 'Effacer toutes les données' }).click();
await page.waitForTimeout(400);
check('Modale de confirmation ouverte', await page.getByRole('dialog').isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Échap ferme la modale', await page.getByRole('dialog').count() === 0);

// Cible tactile
const btn = page.getByRole('button', { name: 'Enregistrer le profil' });
const box = await btn.boundingBox();
check('Cible tactile ≥ 44px', box.height >= 44, `${Math.round(box.height)}px`);

await page.screenshot({ path: `${SHOT}/ipad-light-settings.png` });

// Pas de défilement horizontal
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Aucun débordement horizontal (iPad)', overflow <= 0, `${overflow}px`);

// ---------- iPhone ----------
const iphoneCtx = await browser.newContext({ ...devices['iPhone 14'] });
const phone = await iphoneCtx.newPage();
phone.on('pageerror', (e) => errors.push(`[iphone] pageerror: ${e.message}`));
await phone.goto(BASE, { waitUntil: 'networkidle' });
await phone.waitForTimeout(500);

check('Le rail latéral est masqué sur iPhone', await phone.locator('aside').isHidden());
const tabs = await phone.locator('nav.fixed a').count();
check('Barre d’onglets compacte (≤ 6 entrées)', tabs > 0 && tabs <= 6, `${tabs} onglets`);

await phone.locator('nav.fixed a', { hasText: 'Plus' }).click();
await phone.waitForTimeout(600);
check('L’onglet « Plus » donne accès à toutes les sections',
  await phone.getByRole('heading', { name: 'Toutes les sections' }).isVisible());

const phoneOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('Aucun débordement horizontal (iPhone)', phoneOverflow <= 0, `${phoneOverflow}px`);

await phone.screenshot({ path: `${SHOT}/iphone-more.png` });

// ---------- prefers-reduced-motion ----------
const reducedCtx = await browser.newContext({ ...devices['iPad Pro 11'], reducedMotion: 'reduce' });
const reduced = await reducedCtx.newPage();
reduced.on('pageerror', (e) => errors.push(`[reduced] pageerror: ${e.message}`));
await reduced.goto(BASE, { waitUntil: 'networkidle' });
await reduced.getByRole('link', { name: /Paramètres/ }).first().click();
await reduced.waitForTimeout(500);
check('Application utilisable avec animations réduites',
  await reduced.getByRole('heading', { name: 'Paramètres' }).isVisible());
const opacity = await reduced.getByRole('heading', { name: 'Paramètres' })
  .evaluate((el) => getComputedStyle(el.closest('div[style]') ?? el).opacity);
check('Le contenu est bien visible (pas figé à opacité 0)', parseFloat(opacity) === 1, opacity);

await browser.close();

console.log('\n--- Erreurs console ---');
const real = errors.filter((e) => !/favicon|manifest|icon-\d+\.png/i.test(e));
console.log(real.length === 0 ? 'aucune' : real.join('\n'));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length === 0 && real.length === 0 ? 0 : 1);
