import { hasEnvValue, jsonResponse } from './_shared.js';

export const config = { runtime: 'edge' };

/**
 * Vrai uniquement dans le runtime Edge de Vercel : `EdgeRuntime` est une
 * variable globale que Vercel injecte SEULEMENT quand la fonction s'exécute
 * réellement en Edge Runtime (documenté par Vercel) — absente en Node.js.
 * Sert uniquement au diagnostic ci-dessous (point 3 du cahier des charges :
 * « Edge ou Node Runtime ? ») ; `export const config = { runtime: 'edge' }`
 * ci-dessus reste la déclaration qui compte, ceci ne fait que la confirmer
 * a posteriori, au cas où le déploiement l'aurait silencieusement ignorée.
 */
const runtime = typeof globalThis !== 'undefined' && 'EdgeRuntime' in globalThis ? 'edge' : 'node';

/**
 * Indique, sans jamais rien en révéler, QUELS relais ont une clé configurée
 * côté serveur — c'est tout ce que le frontend a besoin de savoir pour
 * afficher un statut honnête (« configuré » / « non configuré ») et pour
 * qu'`isAvailable()` (interface `AIProvider`) reflète la réalité serveur.
 *
 * Lit `process.env` à CHAQUE requête (jamais une valeur mémorisée au
 * démarrage) : sur Vercel, les variables d'environnement sont figées par
 * DÉPLOIEMENT — une variable ajoutée ou modifiée dans les réglages du
 * projet n'est visible que par les déploiements créés APRÈS cet
 * enregistrement, jamais par un déploiement déjà existant. Cette fonction ne
 * peut rien y changer : son seul rôle est de refléter fidèlement ce que CE
 * déploiement voit réellement.
 *
 * DIAGNOSTIC (temporaire, sans risque) : `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`
 * et `VERCEL_GIT_COMMIT_REF` sont des variables SYSTÈME que Vercel injecte
 * lui-même sur CHAQUE déploiement (documenté, non secrètes — Vercel les
 * expose même au navigateur quand « Automatically expose System Environment
 * Variables » est actif). Elles ne révèlent ni clé ni configuration privée :
 * elles permettent seulement de vérifier, depuis la réponse elle-même, QUEL
 * déploiement (quel environnement, quelle branche, quel commit) a réellement
 * traité cette requête — la seule façon de distinguer depuis l'extérieur
 * « Vercel ne transmet pas les variables » de « ce n'est pas le déploiement
 * que je crois interroger ». Sûr à retirer une fois le diagnostic terminé.
 */
export default async function handler(): Promise<Response> {
  const openaiConfigured = hasEnvValue(process.env.OPENAI_API_KEY);
  const geminiConfigured = false; // Legacy response fields retained for older installed clients.

  return jsonResponse({
    // Champs historiques, consommés par `services/ai/providerStatus.ts` — inchangés.
    openai: openaiConfigured,
    gemini: geminiConfigured,
    // Mêmes valeurs, sous le nom demandé pour le diagnostic manuel.
    openaiConfigured,
    geminiConfigured,
    diagnostic: {
      runtime,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      gitCommitRef: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      checkedAt: new Date().toISOString(),
    },
  });
}
