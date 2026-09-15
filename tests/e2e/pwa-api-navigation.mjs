import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

/**
 * SERVICE WORKER — /api/* ne doit jamais être intercepté par le repli SPA.
 *
 * Symptôme réel rapporté : ouvrir /api/ai/status directement dans le
 * navigateur (une NAVIGATION de page) affichait l'application Musab Study au
 * lieu du JSON attendu. Cause : le service worker généré par
 * `vite-plugin-pwa` sert `index.html` pour toute navigation non précachée
 * (`NavigationRoute`, nécessaire pour que /cours, /quiz… restent utilisables
 * hors-ligne), sans exclure `/api/*` — corrigé par `navigateFallbackDenylist`
 * dans `vite.config.ts`.
 *
 * Vérifié ici avec l'API Playwright `response.fromServiceWorker()` : la
 * question posée n'est pas « que répond le serveur local à /api/ai/status »
 * (`vite preview` n'a de toute façon aucune fonction serverless réelle et
 * pourrait répondre autre chose que Vercel) mais « le service worker a-t-il
 * intercepté cette navigation », ce qui reproduit exactement le mécanisme en
 * cause, indépendamment de ce que le serveur renvoie ensuite.
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
const context = await browser.newContext();
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });

// Le service worker s'enregistre au premier chargement mais ne CONTRÔLE pas
// encore cette première page (comportement standard) : un rechargement est
// nécessaire pour que la navigation suivante passe réellement par lui,
// exactement comme pour un utilisateur qui revient sur le site.
await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), { timeout: 20_000 }).catch(() => {});
await page.reload({ waitUntil: 'networkidle' });
const controlled = await page.evaluate(() => Boolean(navigator.serviceWorker.controller));
check('Le service worker contrôle la page après un rechargement (prérequis du test)', controlled);

if (controlled) {
  const response = await page.goto(new URL('api/ai/status', BASE).toString(), { waitUntil: 'domcontentloaded' });
  const fromSW = response?.fromServiceWorker() ?? null;
  check(
    'Naviguer vers /api/ai/status n’est PAS intercepté par le service worker (navigateFallbackDenylist)',
    fromSW === false,
    `fromServiceWorker() = ${fromSW}`,
  );

  // Contre-épreuve : une vraie route de page (jamais dans la liste
  // d'exclusion) reste bien servie par le service worker hors-ligne — la
  // correction n'a pas cassé le repli SPA lui-même.
  const appResponse = await page.goto(new URL('cours', BASE).toString(), { waitUntil: 'domcontentloaded' });
  check(
    'Une vraie route de page (/cours) reste servie par le service worker (repli SPA intact)',
    appResponse?.fromServiceWorker() === true,
  );
} else {
  check(
    'Naviguer vers /api/ai/status n’est PAS intercepté par le service worker (navigateFallbackDenylist)',
    false,
    'ignoré : le service worker n’a pas pris le contrôle de la page dans cet environnement',
  );
}

console.log('\n--- Erreurs console ---');
console.log(errors.length ? errors.join('\n') : 'aucune');

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées`);
if (passed !== results.length || errors.length > 0) process.exit(1);
