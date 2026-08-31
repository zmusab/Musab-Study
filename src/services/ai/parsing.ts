import { AiRequestError } from './types';

/**
 * Extrait un tableau JSON d'une réponse, même entourée de texte ou de balises
 * de code. Les modèles ajoutent parfois une phrase d'introduction malgré la
 * consigne ; refuser la réponse pour cette seule raison serait fragile.
 *
 * Indépendant du fournisseur : n'importe quel texte brut peut passer ici,
 * quel que soit le modèle qui l'a produit.
 */
export function extractJsonArray<T>(raw: string): T[] {
  const withoutFences = raw.replace(/```(?:json)?/gi, '').trim();
  const start = withoutFences.indexOf('[');
  const end = withoutFences.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    throw new AiRequestError("La réponse de l'IA n'était pas au format attendu.");
  }
  try {
    const parsed: unknown = JSON.parse(withoutFences.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error('pas un tableau');
    return parsed as T[];
  } catch (cause) {
    throw new AiRequestError("La réponse de l'IA n'a pas pu être interprétée.", cause);
  }
}
