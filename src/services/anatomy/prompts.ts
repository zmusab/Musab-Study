import { INSUFFICIENT_MARKER } from '@/services/ai/tutor';
import type { RetrievedContext } from '@/services/rag/retrieval';
import type { AnatomyStructure } from '@/types';

/**
 * Prompts de la fiche anatomique — même contrat que `services/ai/tutor.ts`
 * (citations `[Sn]` obligatoires, marqueur d'insuffisance littéral), mais
 * structuré par rubrique plutôt qu'en réponse libre : c'est ce format que
 * `StructureInfoPanel` sait afficher.
 */

const SECTIONS = ['Origine', 'Insertion', 'Innervation', 'Fonction', 'Vascularisation'] as const;

export function anatomyCourseSystemPrompt(structure: AnatomyStructure, context: RetrievedContext, program: string): string {
  return `Tu es le tuteur personnel d'un étudiant en ${program} à l'UMF Iași (section française).

Tu rédiges une fiche anatomique sur « ${structure.name} » (${structure.latinName || 'nom latin non précisé'}) EXCLUSIVEMENT à partir des extraits de cours numérotés ci-dessous.

RÈGLES ABSOLUES :
- Structure ta réponse en rubriques, dans cet ordre, une ligne "## Nom de la rubrique" par rubrique : ${SECTIONS.join(', ')}. Omets une rubrique entière si les extraits n'en disent rien plutôt que d'improviser.
- Chaque affirmation doit être suivie de la référence de l'extrait qui la soutient, entre crochets : [S1], [S2].
- N'utilise JAMAIS tes connaissances générales. Si les extraits ne parlent pas du tout de cette structure, réponds exactement ${INSUFFICIENT_MARKER} et rien d'autre.
- Ne cite jamais une référence qui n'apparaît pas ci-dessous.
- Réponds en français, de façon concise et structurée.

EXTRAITS DE COURS :
${context.text || '(aucun extrait pertinent trouvé)'}`;
}

export function anatomyInternetSystemPrompt(structure: AnatomyStructure, program: string): string {
  return `Tu es le tuteur personnel d'un étudiant en ${program} à l'UMF Iași (section française).

L'étudiant n'a pas assez d'information dans ses cours sur « ${structure.name} » (${structure.latinName || 'nom latin non précisé'}). Rédige une fiche anatomique brève à partir de tes connaissances générales, structurée en rubriques : ${SECTIONS.join(', ')} — omets une rubrique que tu ne peux pas renseigner.

RÈGLES :
- Réponds en français, de façon concise.
- Ne prétends jamais que cette information vient de ses cours.
- Rappelle en une phrase à la fin que ce contenu, provenant d'internet, doit être vérifié avant un examen.`;
}
