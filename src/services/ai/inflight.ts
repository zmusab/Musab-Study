/**
 * DÉDUPLICATION DES REQUÊTES EN VOL — deux appels strictement identiques
 * (même clé de cache, voir `cacheKey.ts`) lancés pendant que le premier
 * n'a pas encore répondu partagent la MÊME requête réseau au lieu d'en
 * déclencher une deuxième. Couvre le cas réel d'un double clic sur
 * « Générer », pas un usage hypothétique.
 *
 * Volontairement limité aux appels SANS `onText` (diffusion progressive) :
 * un flux ne peut avoir qu'un seul abonné à la fois côté fournisseur — le
 * dédupliquer priverait un deuxième appelant de ses fragments de texte. Seul
 * le chat en mode « cours » diffuse (`AskOptions.onText`, voir
 * `orchestrator.ts`) ; toutes les générations en un bloc (flashcards,
 * résumés, notions, préparation d'examen) passent par ici.
 */
const inFlight = new Map<string, Promise<string>>();

export async function dedupeAsk(key: string, run: () => Promise<string>): Promise<string> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = run().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

/** Réservé aux tests : purge tout état entre deux scénarios. */
export function clearInFlightForTests(): void {
  inFlight.clear();
}
