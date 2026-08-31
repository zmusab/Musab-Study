import type { AnswerProvenance, Citation } from '@/types';
import type { RetrievedContext } from '@/services/rag/retrieval';

/**
 * Vérification des réponses du tuteur.
 *
 * Le prototype demandait au modèle de répondre « uniquement d'après le cours »
 * et lui faisait confiance. Ici la promesse est tenue par une VÉRIFICATION
 * effectuée après coup, côté application :
 *
 *  1. chaque fragment transmis reçoit une référence courte (S1, S2, …) ;
 *  2. le modèle doit citer ces références dans son texte ;
 *  3. l'application relit la réponse et ne conserve que les références qui
 *     correspondent réellement à un fragment envoyé.
 *
 * Une réponse en mode « cours » qui ne cite rien de vérifiable est rétrogradée
 * en « information insuffisante ». Le modèle ne peut donc pas faire passer une
 * connaissance générale pour un extrait de cours, même s'il l'affirme.
 */

export const INSUFFICIENT_MARKER = 'INSUFFISANT';

export function courseSystemPrompt(context: RetrievedContext, program: string): string {
  return `Tu es le tuteur personnel d'un étudiant en ${program} à l'UMF Iași (section française).

Tu réponds EXCLUSIVEMENT à partir des extraits de cours numérotés ci-dessous.

RÈGLES ABSOLUES :
- Chaque affirmation doit être suivie de la référence de l'extrait qui la
  soutient, entre crochets : [S1], [S2]. Plusieurs références sont possibles.
- N'utilise JAMAIS tes connaissances générales. Si les extraits ne contiennent
  pas la réponse, même partiellement, réponds exactement ${INSUFFICIENT_MARKER}
  et rien d'autre.
- Ne cite jamais une référence qui n'apparaît pas ci-dessous.
- Réponds en français, de façon structurée et concise. Va droit au fait :
  l'étudiant révise, il n'a pas besoin d'introduction.

EXTRAITS DE COURS :
${context.text || '(aucun extrait pertinent trouvé)'}`;
}

export function internetSystemPrompt(context: RetrievedContext, program: string): string {
  return `Tu es le tuteur personnel d'un étudiant en ${program} à l'UMF Iași (section française).

Tu disposes de deux sources, et tu dois les distinguer sans ambiguïté :
- les extraits de cours de l'étudiant ci-dessous, que tu cites avec [S1], [S2] ;
- une recherche internet, que tu utilises en complément.

RÈGLES :
- Traite d'abord ce que disent ses cours, en citant les références.
- Introduis ensuite tout apport externe par une section « 🌐 Complément
  internet », en précisant qu'il doit être vérifié avant un examen car il ne
  provient pas de ses cours.
- N'attribue jamais à ses cours une information qui n'y figure pas.
- Réponds en français, de façon concise.

EXTRAITS DE COURS :
${context.text || '(aucun extrait pertinent trouvé)'}`;
}

/** Références [Sn] réellement présentes dans un texte. */
export function extractReferences(answer: string): string[] {
  return [...new Set(Array.from(answer.matchAll(/\[(S\d+)\]/g), (match) => match[1]!))];
}

export interface VerifiedAnswer {
  provenance: AnswerProvenance;
  text: string;
  citations: Citation[];
  /** Références citées par le modèle qui ne correspondaient à aucun extrait. */
  invalidReferences: string[];
}

/**
 * Vérifie une réponse produite en mode « cours ».
 * C'est ici que la garantie devient structurelle plutôt que déclarative.
 */
export function verifyCourseAnswer(
  answer: string,
  context: RetrievedContext,
): VerifiedAnswer {
  const trimmed = answer.trim();

  // Le modèle annonce lui-même qu'il n'a pas la réponse.
  if (trimmed.length === 0 || trimmed.toUpperCase().replace(/[.\s]/g, '') === INSUFFICIENT_MARKER) {
    return {
      provenance: 'insufficient',
      text: "⚠️ Cette information ne se trouve pas dans tes cours importés.",
      citations: [],
      invalidReferences: [],
    };
  }

  const byRef = new Map(context.sources.map((source) => [source.ref, source]));
  const cited = extractReferences(trimmed);
  const valid = cited.filter((ref) => byRef.has(ref));
  const invalid = cited.filter((ref) => !byRef.has(ref));

  // Aucune référence vérifiable : impossible de garantir l'origine de la
  // réponse, on refuse donc de la présenter comme venant du cours.
  if (valid.length === 0) {
    return {
      provenance: 'insufficient',
      text:
        "⚠️ Cette information ne se trouve pas dans tes cours importés.\n\n" +
        "L'assistant a produit une réponse, mais sans pouvoir l'appuyer sur un passage de tes documents. Elle n'est donc pas affichée : elle viendrait de connaissances générales, pas de ton cours.",
      citations: [],
      invalidReferences: invalid,
    };
  }

  const citations: Citation[] = valid.map((ref) => {
    const source = byRef.get(ref)!;
    return {
      chunkId: source.chunkId,
      documentId: source.documentId,
      documentName: source.documentName,
      chapterId: source.chapterId,
      chapterName: source.chapterName,
      subjectName: source.subjectName,
      excerpt: source.excerpt,
    };
  });

  return {
    // Les références inventées sont retirées du texte affiché pour ne pas
    // laisser croire à une source qui n'existe pas.
    text: invalid.reduce((text, ref) => text.replaceAll(`[${ref}]`, ''), trimmed),
    provenance: 'course',
    citations,
    invalidReferences: invalid,
  };
}

/** Vérifie une réponse en mode « internet » : les citations de cours restent contrôlées. */
export function verifyInternetAnswer(
  answer: string,
  context: RetrievedContext,
): VerifiedAnswer {
  const trimmed = answer.trim();
  if (trimmed.length === 0) {
    return {
      provenance: 'error',
      text: "L'assistant n'a pas produit de réponse. Réessaie.",
      citations: [],
      invalidReferences: [],
    };
  }

  const byRef = new Map(context.sources.map((source) => [source.ref, source]));
  const cited = extractReferences(trimmed);
  const invalid = cited.filter((ref) => !byRef.has(ref));

  const citations: Citation[] = cited
    .filter((ref) => byRef.has(ref))
    .map((ref) => {
      const source = byRef.get(ref)!;
      return {
        chunkId: source.chunkId,
        documentId: source.documentId,
        documentName: source.documentName,
        chapterId: source.chapterId,
        chapterName: source.chapterName,
        subjectName: source.subjectName,
        excerpt: source.excerpt,
      };
    });

  return {
    text: invalid.reduce((text, ref) => text.replaceAll(`[${ref}]`, ''), trimmed),
    provenance: 'internet',
    citations,
    invalidReferences: invalid,
  };
}
