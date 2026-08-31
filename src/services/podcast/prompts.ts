import type { LengthPreset } from './plan';
import type { PodcastConcept } from '@/types';
import type { RetrievedContext } from '@/services/rag/retrieval';

/**
 * Prompts du pipeline en deux étapes.
 *
 * Étape 1 (analyse) : sélectionner les notions qui méritent d'être retenues,
 * pas résumer chaque phrase du document.
 * Étape 2 (dialogue) : transformer ces notions en une vraie conversation entre
 * deux étudiants, jamais en lecture du cours à voix haute.
 */

export function analysisSystemPrompt(preset: LengthPreset, context: RetrievedContext): string {
  return `Tu prépares le contenu d'un podcast d'étude pour un étudiant en dentisterie (UMF Iași, section française), à partir de ses propres extraits de cours numérotés ci-dessous.

Ta tâche N'EST PAS de résumer chaque phrase. Sélectionne UNIQUEMENT les ${preset.conceptCount} notions qui méritent le plus d'être retenues : les concepts indispensables, les informations susceptibles de tomber à l'examen, les notions difficiles ou sources de confusion fréquente, et les relations entre elles.

RÈGLES ABSOLUES :
- Chaque notion doit être appuyée par au moins une référence d'extrait, entre crochets : "S1", "S2".
- N'utilise QUE les extraits ci-dessous. N'invente aucune notion absente du texte.
- Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ni après, sans balises de code. Format exact :
[{"label":"nom concis de la notion","importance":1|2|3,"pitfall":true|false,"refs":["S1","S2"]}]
- "importance" : 3 si probable à l'examen, 1 si secondaire, 2 sinon.
- "pitfall" : true si c'est une source fréquente de confusion ou d'erreur.

EXTRAITS DE COURS :
${context.text}`;
}

const SPEAKER_GUIDE = `PERSONNAGES :
- Locuteur A : l'étudiant qui pose les questions. Il représente les difficultés naturelles : « Pourquoi ? », « Attends, ça veut dire que… ? », « Je ne suis pas sûr de comprendre cette partie. »
- Locuteur B : l'étudiant plus avancé qui explique et structure : « Oui, mais attention… », « La chose importante ici, c'est… », « Il faut distinguer X de Y. »

STYLE :
- Une vraie conversation naturelle, pas un cours lu à voix haute. Les deux locuteurs se répondent, reformulent, font des liens, ont de petites réactions naturelles (« Ah oui, je vois. », « Exactement. », « C'est justement là qu'on peut se tromper. »).
- Chaque réplique doit apporter quelque chose. Pas de remplissage.
- Tu peux utiliser des exemples cliniques ou des anecdotes CLAIREMENT FICTIFS pour rendre une notion mémorable (« Imagine qu'un patient arrive avec… », « Prenons un exemple : … »). Ces répliques ont "type":"example" et "source":"none" — elles ne doivent jamais être présentées comme un fait extrait du cours.
- Utilise des techniques de mémorisation quand c'est naturel : analogies, contrastes, questions-réponses, rappels.
- Termine par une courte mini-interrogation (1 à 2 questions, type "quiz") posées par B à A, sans donner la réponse tout de suite.`;

export function dialogueSystemPrompt(
  preset: LengthPreset,
  concepts: PodcastConcept[],
  context: RetrievedContext,
  enrichedWithInternet: boolean,
): string {
  const conceptList = concepts
    .map((concept) => `- ${concept.label}${concept.isPitfall ? ' (piège fréquent)' : ''}`)
    .join('\n');

  return `Tu écris le script d'un podcast d'étude en français pour un étudiant en dentisterie, sous forme de dialogue entre deux personnages.

${SPEAKER_GUIDE}

NOTIONS À COUVRIR (dans cet ordre approximatif) :
${conceptList}

Vise environ ${preset.segmentBudget} répliques (entre ${preset.minMinutes} et ${preset.maxMinutes} minutes de conversation), structurées ainsi : introduction courte, puis pour chaque notion une discussion (concept → explication → éventuellement exemple ou piège), une connexion entre au moins deux notions si c'est pertinent, un récapitulatif, puis la mini-interrogation finale.

RÈGLES DE SOURçAGE, ABSOLUES :
- Toute réplique qui affirme un fait précis tiré du cours doit citer sa source avec "source":"cours" et inclure la référence entre crochets dans le texte, ex. "Le masséter est innervé par le nerf massétérique [S1]." Cite uniquement des références qui apparaissent ci-dessous.
- N'invente AUCUNE information médicale absente des extraits. Si une notion listée manque de détails dans les extraits pour être expliquée en profondeur, reste général plutôt que d'inventer.
${
  enrichedWithInternet
    ? '- Tu peux compléter avec des connaissances générales vérifiées, mais alors marque OBLIGATOIREMENT cette réplique "source":"internet" et fais dire au personnage que ce point vient d\'une recherche complémentaire, à vérifier avant l\'examen.'
    : "- N'utilise AUCUNE connaissance extérieure au cours. Si tu n'as pas assez d'éléments, reste sur ce que les extraits permettent d'affirmer."
}
- Les répliques d'introduction, de transition, d'exemple fictif ou de question de mini-interrogation utilisent "source":"none" et ne doivent pas être présentées comme un fait du cours.

Réponds UNIQUEMENT avec un tableau JSON valide, sans texte avant ni après, sans balises de code. Format exact :
[{"speaker":"A"|"B","type":"intro"|"concept"|"explanation"|"example"|"pitfall"|"connection"|"recap"|"quiz","source":"cours"|"internet"|"none","text":"..."}]

EXTRAITS DE COURS DISPONIBLES :
${context.text}`;
}
