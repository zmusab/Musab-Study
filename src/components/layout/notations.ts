/**
 * NOTATIONS DE MARGE — « des petites notes de formule dans le fond ».
 *
 * Première tentative, abandonnée : six étiquettes flottant en position fixe
 * dans le viewport. Elles ne se rattachaient à rien, chevauchaient le bord des
 * cartes, et sur une page peu remplie elles ressemblaient à des débris tombés
 * au milieu du vide. Le décor ne tient que s'il est ANCRÉ à quelque chose.
 *
 * Chaque notation est donc désormais liée à une page, et posée en surtitre
 * juste au-dessus de son titre — l'endroit où un étudiant annote la marge de
 * son cahier avant d'écrire le titre du chapitre.
 *
 * RÈGLE ABSOLUE : rien d'inventé. Chaque marque est soit une constante réelle
 * de ce projet (les paliers d'intervalle de `core/srs`, les bornes d'ease, le
 * nombre d'options d'un QCM, l'algorithme de récupération), soit un fait de
 * dentisterie vérifiable. Un étudiant en dentisterie LIRA ces marques : une
 * approximation y serait pire que rien.
 */
export const PAGE_NOTATIONS: Readonly<Record<string, string>> = {
  // `INTERVAL_STEPS` de core/srs — les paliers réellement appliqués.
  '/': '1 · 3 · 7 · 14 · 30 j',
  // L'algorithme de `services/rag/retrieval.ts`, avec ses vraies constantes.
  '/recherche': 'BM25 · k₁ = 1,5',
  // Hydroxyapatite : la maille minérale de l'émail.
  '/cours': 'Ca₁₀(PO₄)₆(OH)₂',
  // Ce que fait le moteur local : pondérer des termes, pas comprendre.
  '/ia': '∑ tf · idf',
  // La récurrence SM-2 appliquée par `scheduleNext`.
  '/revisions': 'I(n) = I(n−1) × EF',
  // MIN_EASE / MAX_EASE de core/srs.
  '/flashcards': 'EF ∈ [1,3 ; 3,2]',
  // Un QCM = 1 bonne réponse + 3 distracteurs.
  '/quiz': 'p(hasard) = 1/4',
  // La courbe d'oubli d'Ebbinghaus, le modèle derrière la répétition espacée.
  '/progression': 'R = e^(−t/S)',
  // Les trois branches du nerf trijumeau, cinquième nerf crânien.
  '/anatomie': 'n. V — V₁ V₂ V₃',
  '/calendrier': 't₀ + Δt',
  // pH critique de déminéralisation de l'émail.
  '/notes': 'pH critique 5,5',
};

/**
 * Notation d'un chemin. Les sous-routes héritent de leur section (`/cours/42`
 * porte la marque de « Cours »), et une page sans marque n'en invente pas.
 */
export function notationFor(pathname: string): string | null {
  if (PAGE_NOTATIONS[pathname]) return PAGE_NOTATIONS[pathname]!;
  const segment = `/${pathname.split('/')[1] ?? ''}`;
  return PAGE_NOTATIONS[segment] ?? null;
}
