import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

/*
 * Chemin de base, adapté à l'hébergeur qui construit le site.
 *
 * Le défaut est '/' — ce qui convient à Vercel, à un développement local, et à
 * n'importe quel hébergeur qui sert le site à la racine de son domaine. Il n'y
 * a qu'UNE exception : GitHub Pages, qui sert le site sous /<nom-du-dépôt>/.
 * On la détecte via `GITHUB_ACTIONS`, une variable que les exécuteurs GitHub
 * Actions définissent TOUJOURS, sans réglage à activer côté projet — contrairement
 * à `VERCEL`, exposée uniquement si l'option « Automatically expose System
 * Environment Variables » est active dans les réglages du projet Vercel. Se
 * reposer sur `VERCEL` faisait donc silencieusement retomber le chemin sur
 * /Musab-Study/ dès que ce réglage était désactivé — exactement le genre
 * d'erreur invisible en local et qui casse tout une fois déployé.
 *
 * Ce chemin est aussi SENSIBLE À LA CASSE sur GitHub Pages : le dépôt
 * s'appelle « Musab-Study », donc « /musab-study/ » renverrait une page
 * blanche. La valeur est dérivée de GITHUB_REPOSITORY plutôt que codée en
 * dur, pour survivre à un renommage du dépôt.
 *
 * BASE_PATH reste disponible pour surcharger manuellement au besoin.
 */
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base =
  process.env.BASE_PATH ??
  (process.env.GITHUB_ACTIONS ? `/${repositoryName ?? 'Musab-Study'}/` : '/');

export default defineConfig({
  base,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // pdf.js et le SDK sont volumineux mais indispensables au démarrage :
        // ils restent en précache.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Les modèles 3D (106 Mo au total, corps entier sans simplification)
        // sont volontairement EXCLUS du précache : les télécharger à
        // l'installation de la PWA pénaliserait tout utilisateur qui n'ouvre
        // jamais /anatomie. Ils passent par le cache d'exécution ci-dessous —
        // mis en cache dès la première consultation, donc disponibles hors
        // ligne ensuite, région par région, exactement comme ils sont chargés
        // à l'écran.
        //
        // Même raisonnement pour les 934 vignettes anatomiques : ~1,5 Mo mais
        // surtout 934 entrées de précache pour une seule page. Elles sont
        // exclues du glob et servies par le cache d'exécution.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/anatomy/thumbs/**', '**/anatomy/schema/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/anatomy/') && url.pathname.endsWith('.glb'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'anatomie-3d',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Vignettes de structures et schéma corporel : petits PNG, mis en
            // cache au fil de la consultation plutôt qu'en bloc.
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/anatomy/thumbs/') || url.pathname.startsWith('/anatomy/schema/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'anatomie-vignettes',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'Musab Study',
        short_name: 'Musab Study',
        description: "Environnement d'étude personnel — Dentisterie, UMF Iași",
        lang: 'fr',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        background_color: '#F7F6F3',
        theme_color: '#F7F6F3',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
