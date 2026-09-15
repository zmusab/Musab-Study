/**
 * Accord en nombre — « 1 carte », « 3 cartes ».
 *
 * L'application écrivait partout « carte(s) », « chapitre(s) analysé(s) »,
 * « 2 notion(s) détectée(s) ». C'est la marque d'un texte produit par un
 * programme et non écrit pour quelqu'un : personne ne parle ainsi, et sur un
 * écran qui en aligne cinq d'affilée, la page entière prend un air de sortie
 * de base de données.
 *
 * Règle du français : le singulier tient jusqu'à 1 inclus — « 0 carte », « 1
 * carte », « 2 cartes ». C'est bien 0 au singulier, contrairement à l'anglais.
 */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count > 1 ? (pluralForm ?? `${singular}s`) : singular}`;
}

/** Le mot seul, accordé — quand le nombre est affiché séparément. */
export function agree(count: number, singular: string, pluralForm?: string): string {
  return count > 1 ? (pluralForm ?? `${singular}s`) : singular;
}
