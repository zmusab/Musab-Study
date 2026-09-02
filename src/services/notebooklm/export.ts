import type { Chapter, ID, Note, StudyDocument, Subject } from '@/types';

/**
 * NOTEBOOKLM — export manuel, PAS une intégration API.
 *
 * Vérifié avant d'écrire ce fichier : NotebookLM (Google) n'a pas d'API
 * publique en libre-service pour un usage personnel. Une « Gemini Notebook
 * API » existe, mais réservée aux clients Entreprise (licence + projet
 * Google Cloud) — inaccessible à une application personnelle comme Musab
 * Study. Aucun appel réseau vers NotebookLM n'existe donc ici, et ce
 * fichier n'en simule aucun : il assemble le contenu RÉEL d'une matière
 * (documents déjà importés, notes déjà écrites) en un seul texte lisible,
 * que l'utilisateur peut lui-même charger comme source sur
 * notebooklm.google.com — la seule voie technique réellement disponible
 * aujourd'hui.
 */

export interface NotebookLmExportInput {
  subject: Subject;
  /** Chapitres de cette matière. */
  chapters: readonly Chapter[];
  /** Documents de cette matière, texte intégral déjà chargé (voir `getDocument`). */
  documents: readonly StudyDocument[];
  /** Notes de cette matière. */
  notes: readonly Note[];
}

function chapterLabel(chapters: readonly Chapter[], chapterId: ID | null): string {
  if (chapterId === null) return 'Sans chapitre';
  return chapters.find((chapter) => chapter.id === chapterId)?.name ?? 'Sans chapitre';
}

/**
 * Assemble un texte unique, regroupé par chapitre — documents puis notes.
 * Aucune information n'est résumée, reformulée ou inventée : c'est le
 * contenu réellement enregistré, tel quel.
 */
export function buildNotebookLmExportText(input: NotebookLmExportInput): string {
  const lines: string[] = [
    `# ${input.subject.name}`,
    '',
    'Export Musab Study — à importer manuellement comme source dans NotebookLM.',
    `Généré le ${new Date().toLocaleDateString('fr-FR')}.`,
    '',
  ];

  const orderedChapterIds = [...input.chapters.map((chapter) => chapter.id), null];
  for (const chapterId of orderedChapterIds) {
    const documents = input.documents.filter((document) => document.chapterId === chapterId);
    const notes = input.notes.filter((note) => note.chapterId === chapterId);
    if (documents.length === 0 && notes.length === 0) continue;

    lines.push(`## ${chapterLabel(input.chapters, chapterId)}`, '');

    for (const document of documents) {
      lines.push(`### Document : ${document.name}`, '', document.text.trim(), '');
    }
    for (const note of notes) {
      lines.push(`### Note : ${note.title}`, '', note.text.trim(), '');
    }
  }

  return lines.join('\n').trim();
}

/** Nom de fichier sûr pour un téléchargement — pas de caractère qui gênerait un système de fichiers. */
export function notebookLmExportFilename(subjectName: string): string {
  const safe = subjectName.trim().replace(/[^\p{L}\p{N}\-_]+/gu, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return `${safe || 'matiere'}-notebooklm.txt`;
}

/** Déclenche le téléchargement du fichier assemblé — même mécanisme que l'export de sauvegarde (Paramètres). */
export function downloadNotebookLmExport(subjectName: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = notebookLmExportFilename(subjectName);
  anchor.click();
  URL.revokeObjectURL(url);
}
