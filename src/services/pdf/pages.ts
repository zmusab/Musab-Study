/**
 * Numéro de page (1-indexé) contenant l'offset `charOffset`, à partir des
 * offsets de début de page produits par `extractPdfText`. Utilisé aussi bien
 * pour situer un fragment RAG (chunking.ts) que pour situer un résultat de
 * recherche dans le lecteur (search.ts).
 */
export function pageAtOffset(charOffset: number, pageOffsets: number[]): number {
  let page = 1;
  for (let i = 0; i < pageOffsets.length; i += 1) {
    if (pageOffsets[i]! <= charOffset) page = i + 1;
    else break;
  }
  return page;
}
