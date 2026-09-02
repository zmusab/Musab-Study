import { hasEnvValue, jsonResponse } from './_shared';

export const config = { runtime: 'edge' };

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
 */
export default async function handler(): Promise<Response> {
  return jsonResponse({
    openai: hasEnvValue(process.env.OPENAI_API_KEY),
    gemini: hasEnvValue(process.env.GEMINI_API_KEY),
  });
}
