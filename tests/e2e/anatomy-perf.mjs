/**
 * Mesure de performance de l'Anatomie 3D — outil MANUEL, volontairement hors
 * de `npm run test:e2e` (il mesure, il n'affirme rien).
 *
 * Usage : npm run build && npm run preview, puis
 *         node tests/e2e/anatomy-perf.mjs
 *
 * LIMITE IMPORTANTE DE CET ENVIRONNEMENT — à lire avant d'interpréter les
 * chiffres. Le Chromium disponible ici rend via SwiftShader (rastérisation
 * LOGICIELLE, aucun GPU) :
 *
 *   ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
 *
 * Les FPS pendant une rotation y sont donc dominés par le CPU et ne
 * transposent PAS à un iPad, qui rastérise sur GPU. Ce que cette mesure dit
 * réellement :
 *   - le volume d'assets effectivement téléchargé à l'ouverture (chiffre
 *     transposable, c'est du réseau) ;
 *   - que la boucle de rendu tourne bien à la fréquence d'écran au repos ;
 *   - l'empreinte mémoire JS.
 * Les FPS en rotation sur matériel réel restent à mesurer sur un vrai iPad.
 */
import { chromium, devices } from 'playwright';
const S = '/tmp/claude-0/-home-user-Musab-Study/cc4859d7-b69a-5440-8e47-843f3e83dc5d/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/** Compte les images rendues pendant `ms`, dans la page. */
const FPS = (ms) => `
  new Promise((resolve) => {
    let f = 0; const t0 = performance.now();
    const tick = () => { f++; const dt = performance.now() - t0;
      if (dt >= ${ms}) resolve(Math.round(f * 1000 / dt)); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  })`;

for (const [name, dev] of [['paysage', 'iPad Pro 11 landscape'], ['portrait', 'iPad Pro 11']]) {
  const ctx = await b.newContext({ ...devices[dev] });
  const p = await ctx.newPage();
  let bytes = 0;
  const files = new Set();
  p.on('response', (r) => {
    if (r.url().includes('/anatomy/') && r.url().endsWith('.glb')) {
      bytes += Number(r.headers()['content-length'] ?? 0);
      files.add(r.url().split('/').pop());
    }
  });

  const t0 = Date.now();
  await p.goto('http://localhost:4173/#/anatomie', { waitUntil: 'networkidle' });
  await p.locator('canvas').waitFor({ state: 'visible', timeout: 30000 });
  const tCanvas = Date.now() - t0;
  await p.waitForTimeout(9000);

  const fpsIdle = await p.evaluate(FPS(1500));

  // Rotation réelle : on lance le glissement, PUIS on mesure — sans Promise.all
  // (le glissement bloquait la mesure dans la version précédente).
  const box = await p.locator('canvas').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  const drag = (async () => {
    for (let i = 0; i < 60; i++) {
      await p.mouse.move(box.x + box.width / 2 + (i % 30) * 4, box.y + box.height / 2 + Math.sin(i / 4) * 25);
    }
  })();
  const fpsDrag = await p.evaluate(FPS(1500));
  await drag;
  await p.mouse.up();

  const heap = await p.evaluate(() =>
    performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  );
  console.log(
    `${name.padEnd(9)} | canvas ${tCanvas} ms | ${files.size} GLB / ${(bytes / 1048576).toFixed(1)} Mo | ` +
      `FPS repos ${fpsIdle} | FPS rotation ${fpsDrag} | heap ${heap ?? '?'} Mo`,
  );
  await p.screenshot({ path: `${S}/P-${name}.png` });
  await ctx.close();
}
await b.close();
