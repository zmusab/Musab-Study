import { describe, it, expect, beforeEach } from 'vitest';
import { isLegacyDump, convertLegacyDump, type LegacyDump } from '@/services/legacyImport';
import { importBackup, exportBackup } from '@/services/backup';
import { clearAllData, db } from '@/data/db';

/** Sauvegarde fidèle au format réellement produit par le prototype HTML. */
const LEGACY: LegacyDump = {
  profile: {
    name: 'Musab',
    university: 'UMF Iași – Grigore T. Popa',
    section: 'Française',
    program: 'Dentisterie',
    goals: 'Réussir la session de janvier',
    theme: 'dark',
  },
  subjectsIndex: [{ id: 'id-abc' }],
  subjects: {
    'id-abc': {
      id: 'id-abc',
      name: 'Anatomie',
      color: '#3F4FD1',
      createdAt: '2026-01-10T08:00:00.000Z',
      chapters: [
        {
          id: 'ch-1',
          name: 'Muscles masticateurs',
          documents: [
            {
              id: 'doc-1',
              name: 'Masséter.pdf',
              text: 'Le muscle masséter élève la mandibule. Il est innervé par le nerf massétérique, branche du V3. '.repeat(8),
              createdAt: '2026-01-11T08:00:00.000Z',
            },
          ],
        },
      ],
      cards: [
        {
          id: 'card-1',
          q: 'Quelle est l’innervation du masséter ?',
          a: 'Le nerf massétérique, issu du V3.',
          chapterId: 'ch-1',
          importance: 3,
          difficulty: 2,
          ease: 2.45,
          interval: 14,
          reps: 4,
          lapses: 1,
          due: '2026-09-10T08:00:00.000Z',
          lastReview: '2026-08-27T08:00:00.000Z',
        },
        { id: 'card-2', q: 'Orphelin', a: 'Chapitre supprimé', chapterId: 'ch-inexistant' },
      ],
      quiz: [
        {
          id: 'quiz-1',
          type: 'qcm',
          q: 'Le masséter est innervé par ?',
          options: ['V1', 'V2', 'V3', 'VII'],
          correct: 2,
          explanation: 'Le nerf massétérique naît du V3.',
          chapterId: 'ch-1',
        },
      ],
      reviews: [
        { date: '2026-08-27T08:00:00.000Z', type: 'card', id: 'card-1', correct: true, confidence: 'high' },
        { date: '2026-08-20T21:30:00.000Z', type: 'card', id: 'card-1', correct: false, confidence: 'low' },
        { date: '2026-08-25T10:00:00.000Z', type: 'quiz', id: 'quiz-1', correct: true },
      ],
      notes: [
        { id: 'note-1', chapterId: 'ch-1', text: 'Ne pas confondre V3 et VII.', createdAt: '2026-08-01T08:00:00.000Z' },
      ],
      chat: [
        { role: 'user', text: 'Innervation du masséter ?' },
        { role: 'assistant', text: '📚 Trouvé dans ton cours : nerf massétérique.' },
      ],
    },
  },
  tasks: [
    { id: 'task-1', title: 'Examen d’anatomie', date: '2026-09-15', type: 'exam', subjectId: 'id-abc' },
  ],
  anatomyStructures: [
    {
      id: 'anat-1',
      name: 'Muscle masséter',
      category: 'muscles',
      subjectId: 'id-abc',
      ficheCourse: 'Élève la mandibule.',
      ficheInternet: '',
      generatedAt: '2026-08-02T08:00:00.000Z',
    },
  ],
};

beforeEach(async () => {
  await clearAllData();
});

describe('isLegacyDump', () => {
  it('reconnaît une sauvegarde du prototype', () => {
    expect(isLegacyDump(LEGACY)).toBe(true);
  });

  it('ne confond pas avec le format actuel', () => {
    expect(isLegacyDump({ v: 2, subjects: [], anatomyStructures: [] })).toBe(false);
  });

  it('rejette les valeurs non pertinentes', () => {
    expect(isLegacyDump(null)).toBe(false);
    expect(isLegacyDump('texte')).toBe(false);
    expect(isLegacyDump({})).toBe(false);
  });
});

describe('convertLegacyDump', () => {
  const bundle = convertLegacyDump(LEGACY);

  it('convertit le profil', () => {
    expect(bundle.profile!.name).toBe('Musab');
    expect(bundle.profile!.theme).toBe('dark');
  });

  it('convertit matières, chapitres et documents', () => {
    expect(bundle.subjects).toHaveLength(1);
    expect(bundle.chapters).toHaveLength(1);
    expect(bundle.documents).toHaveLength(1);
    expect(bundle.documents[0]!.charCount).toBeGreaterThan(0);
  });

  it('préserve intégralement l’état de répétition espacée', () => {
    const card = bundle.flashcards.find((c) => c.id === 'card-1')!;
    expect(card.ease).toBe(2.45);
    expect(card.interval).toBe(14);
    expect(card.reps).toBe(4);
    expect(card.lapses).toBe(1);
    expect(card.due).toBe('2026-09-10T08:00:00.000Z');
    expect(card.importance).toBe(3);
  });

  it('détache les cartes pointant vers un chapitre disparu au lieu de les perdre', () => {
    const orphan = bundle.flashcards.find((c) => c.id === 'card-2')!;
    expect(orphan).toBeDefined();
    expect(orphan.chapterId).toBeNull();
  });

  it('convertit l’historique de révision, la donnée irremplaçable', () => {
    expect(bundle.reviewLogs).toHaveLength(3);
    const card1 = bundle.reviewLogs.filter((l) => l.itemId === 'card-1');
    expect(card1).toHaveLength(2);
    expect(card1.filter((l) => l.correct)).toHaveLength(1);
    expect(card1.find((l) => l.confidence === 'high')).toBeDefined();
  });

  it('calcule le jour statistique en heure locale', () => {
    // 21h30 UTC le 20 août : à Iași (UTC+3) c'est déjà le 21.
    const evening = bundle.reviewLogs.find((l) => l.at.startsWith('2026-08-20'))!;
    expect(evening.day).toMatch(/^2026-08-2[01]$/);
  });

  it('convertit le quiz avec sa bonne réponse et son explication', () => {
    const question = bundle.quizQuestions[0]!;
    expect(question.correctIndex).toBe(2);
    expect(question.options).toHaveLength(4);
    expect(question.explanation).toContain('V3');
  });

  it('convertit notes, calendrier et anatomie', () => {
    expect(bundle.notes).toHaveLength(1);
    expect(bundle.calendarEvents[0]!.kind).toBe('exam');
    expect(bundle.anatomyStructures[0]!.name).toBe('Muscle masséter');
  });

  it('crée une fiche pour le contenu présent, aucune pour le contenu vide', () => {
    expect(bundle.anatomySheets).toHaveLength(1);
    expect(bundle.anatomySheets[0]!.origin).toBe('course');
  });

  it('n’invente pas de provenance pour les anciens messages de l’IA', () => {
    // On ne peut pas savoir a posteriori si une ancienne réponse venait
    // réellement du cours : la marquer 📚 serait une affirmation inventée.
    expect(bundle.chatMessages.every((m) => m.provenance === null)).toBe(true);
  });

  it('ignore les documents et notes vides sans planter', () => {
    const empty = convertLegacyDump({
      subjectsIndex: [],
      subjects: {
        s: { id: 's', name: 'X', chapters: [{ id: 'c', name: 'C', documents: [{ id: 'd', text: '  ' }] }], notes: [{ id: 'n', text: '' }] },
      },
    });
    expect(empty.documents).toHaveLength(0);
    expect(empty.notes).toHaveLength(0);
  });
});

describe('import puis export', () => {
  it('restaure la sauvegarde convertie en base et réindexe les fragments', async () => {
    const report = await importBackup(convertLegacyDump(LEGACY));

    expect(report.flashcards).toBe(2);
    expect(report.reviewLogs).toBe(3);

    // Les documents importés doivent redevenir interrogeables par l'IA.
    expect(await db.chunks.count()).toBeGreaterThan(0);
    expect(await db.subjects.count()).toBe(1);
  });

  it('produit un export relisible sans perte des données de révision', async () => {
    await importBackup(convertLegacyDump(LEGACY));
    const exported = await exportBackup();

    expect(exported.v).toBe(3);
    expect(exported.flashcards.find((c) => c.id === 'card-1')!.interval).toBe(14);
    expect(exported.reviewLogs).toHaveLength(3);
  });

  it('remplace les données existantes plutôt que de les fusionner', async () => {
    await importBackup(convertLegacyDump(LEGACY));
    await importBackup(convertLegacyDump(LEGACY));
    // Un double import ne doit pas dupliquer les matières.
    expect(await db.subjects.count()).toBe(1);
  });
});
