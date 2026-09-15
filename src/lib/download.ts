/**
 * TÉLÉCHARGER UN FICHIER depuis l'application — une seule définition.
 *
 * Écrite à l'origine dans `SettingsPage`, elle sert désormais aussi à
 * l'export de flashcards ; la dupliquer aurait laissé deux versions dériver,
 * notamment sur la révocation de l'URL qui est facile à oublier.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Sans révocation, le blob resterait en mémoire pour toute la session.
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, type = 'text/plain;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type }), filename);
}
