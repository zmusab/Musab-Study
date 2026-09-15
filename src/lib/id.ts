/**
 * Identifiants triables dans le temps : préfixe temporel en base 36 + aléa.
 * Deux entités créées dans l'ordre gardent cet ordre au tri lexicographique,
 * ce qui évite un index supplémentaire pour les listes chronologiques.
 */
export function uid(prefix = 'id'): string {
  const time = Date.now().toString(36).padStart(9, '0');
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${time}${random}`;
}
