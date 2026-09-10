import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright';

/**
 * SAUVEGARDE COMPLÈTE — l'aller-retour que les tests unitaires ne peuvent pas
 * faire.
 *
 * `fake-indexeddb` ne restitue pas les Blob : le contenu binaire d'un PDF est
 * perdu par l'environnement de test lui-même, donc aucun test unitaire ne peut
 * prouver qu'un PDF ressort intact d'un aller-retour passant par la base. Ici,
 * c'est un vrai navigateur, un vrai IndexedDB, un vrai fichier téléchargé puis
 * ré-importé — et on compare les octets.
 *
 * Prérequis : `npm run build` puis `npm run preview`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE ?? 'http://localhost:4173/';
const SHOT = process.env.SCREENSHOT_DIR ?? './dist-screenshots';
const SAMPLE_PDF = path.join(__dirname, 'fixtures', 'sample.pdf');
const results = [];
const errors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

/** Empreinte du PDF stocké : taille + somme des octets. Deux fichiers différents ne peuvent pas la partager par hasard. */
async function storedPdfFingerprint(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('musab-study');
        open.onerror = () => reject(new Error('ouverture impossible'));
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('documentFiles', 'readonly');
          const all = tx.objectStore('documentFiles').getAll();
          all.onsuccess = async () => {
            const rows = all.result ?? [];
            if (rows.length === 0) return resolve(null);
            const bytes = new Uint8Array(await rows[0].blob.arrayBuffer());
            let sum = 0;
            for (const b of bytes) sum = (sum + b) % 1_000_000_007;
            resolve({ size: bytes.length, sum, count: rows.length });
          };
          all.onerror = () => reject(new Error('lecture impossible'));
        };
      }),
  );
}

await mkdir(SHOT, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const context = await browser.newContext({ ...devices['iPad Pro 11'], acceptDownloads: true });
const page = await context.newPage();
const main = page.locator('main');
const nav = page.locator('aside, nav.fixed');
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });

// ────────────────── 1. Une bibliothèque avec un vrai PDF ──────────────────
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Créer ma première matière' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom').fill('Anatomie');
await page.getByRole('button', { name: 'Créer', exact: true }).click();
await page.waitForTimeout(600);

await main.getByRole('link', { name: /Anatomie/ }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Ajouter un chapitre' }).click();
await page.waitForTimeout(300);
await page.getByLabel('Nom du chapitre').fill('Trijumeau');
await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
await page.waitForTimeout(600);

// Un chapitre unique est déjà déplié : le cliquer le REFERMERAIT, et
// « Ajouter un document » disparaîtrait avec lui.
await page.getByRole('button', { name: 'Ajouter un document' }).first().click();
await page.waitForTimeout(300);
await page.setInputFiles('input[type="file"]', SAMPLE_PDF);
await page.waitForTimeout(1500);
await page.getByRole('button', { name: 'Enregistrer le document' }).click();
await page.waitForTimeout(1200);

const before = await storedPdfFingerprint(page);
check('Le PDF d’origine est bien conservé en base', before !== null && before.size > 0,
  before ? `${before.size} octets` : 'aucun fichier');

// ────────────────── 2. Export complet ──────────────────
await nav.getByRole('link', { name: 'Paramètres', exact: true }).first().click();
await page.waitForTimeout(700);

const downloadPromise = page.waitForEvent('download', { timeout: 20_000 });
await page.locator('[data-settings-export-full]').click();
const download = await downloadPromise;
const archivePath = path.join(SHOT, 'sauvegarde-complete.zip');
await download.saveAs(archivePath);
check('L’archive complète est téléchargée', download.suggestedFilename().endsWith('.zip'),
  download.suggestedFilename());
check('La notification annonce le PDF joint',
  await page.getByText(/PDF joints?/).isVisible());

// ────────────────── 3. Tout effacer ──────────────────
await page.getByRole('button', { name: 'Effacer toutes les données' }).click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Tout effacer' }).click();
await page.waitForTimeout(1200);

const emptied = await storedPdfFingerprint(page);
check('La base est bien vide avant la restauration', emptied === null,
  emptied ? `${emptied.count} fichier(s) restant(s)` : 'vide');

// ────────────────── 4. Restauration depuis l'archive ──────────────────
await page.setInputFiles('input[type="file"]', archivePath);
await page.waitForTimeout(600);
// `exact` : « Importer une sauvegarde » porte aussi ce nom.
await page.getByRole('button', { name: 'Importer', exact: true }).click();
await page.waitForTimeout(2500);

check('La restauration annonce les PDF récupérés',
  await page.getByText(/PDF restaurés?|PDF restauré/).isVisible());

const after = await storedPdfFingerprint(page);
check('Le PDF est bien revenu', after !== null, after ? `${after.size} octets` : 'aucun fichier');
check(
  'Le PDF restauré est identique à l’original, octet pour octet',
  after !== null && before !== null && after.size === before.size && after.sum === before.sum,
  after && before ? `${before.size}/${before.sum} → ${after.size}/${after.sum}` : 'comparaison impossible',
);

// Le reste du travail est revenu avec lui.
await nav.getByRole('link', { name: 'Cours', exact: true }).first().click();
await page.waitForTimeout(900);
check('La matière est restaurée', await main.getByText('Anatomie').first().isVisible());

await page.screenshot({ path: `${SHOT}/sauvegarde-restauree.png`, fullPage: false });

console.log('\n--- Erreurs console ---');
console.log(errors.length === 0 ? 'aucune' : errors.join('\n'));

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} vérifications passées`);

await browser.close();
if (passed < results.length) process.exit(1);
