import { jsonResponse } from './_shared';

export const config = { runtime: 'edge' };

/**
 * Indique, sans jamais rien en révéler, QUELS relais ont une clé configurée
 * côté serveur — c'est tout ce que le frontend a besoin de savoir pour
 * afficher un statut honnête (« configuré » / « non configuré ») et pour
 * qu'`isAvailable()` (interface `AIProvider`) reflète la réalité serveur.
 */
export default async function handler(): Promise<Response> {
  return jsonResponse({
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  });
}
