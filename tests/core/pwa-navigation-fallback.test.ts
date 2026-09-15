import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Régression : le service worker généré par `vite-plugin-pwa` (mode SPA,
 * `NavigationRoute`) sert `index.html` pour toute NAVIGATION de page qui ne
 * correspond à aucun fichier précaché — nécessaire pour que `/cours`,
 * `/quiz`, etc. restent utilisables hors-ligne. Sans exclusion explicite des
 * routes `/api/*`, taper `/api/ai/status` dans la barre d'adresse du
 * navigateur (une navigation, pas un `fetch()`) était intercepté par le
 * service worker et recevait la coquille de l'application au lieu
 * d'atteindre la fonction Vercel — le symptôme exact rapporté (« /api/ai/status
 * affiche l'application au lieu du JSON »).
 *
 * Vérifié ici sur la CONFIGURATION (`vite.config.ts`), pas sur le service
 * worker généré (qui exigerait un build complet à chaque exécution des
 * tests) — voir aussi la vérification manuelle documentée dans le rapport :
 * `grep NavigationRoute dist/sw.js` après `npm run build` confirme
 * `{denylist:[/^\/api\//]}` sur la route de navigation générée.
 */
describe('PWA — /api/* exclu du repli SPA de navigation', () => {
  it('vite.config.ts déclare navigateFallbackDenylist pour /api/', () => {
    const source = readFileSync(join(process.cwd(), 'vite.config.ts'), 'utf-8');

    expect(source).toMatch(/navigateFallbackDenylist\s*:\s*\[/);
    expect(source).toContain('/api/');
  });
});
