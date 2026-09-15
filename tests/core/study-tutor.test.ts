import { describe, expect, it, vi } from 'vitest';
import { answerWithStudyTutor, resolveStudyQuestion, studyTopic } from '@/services/local/studyTutor';
import { availableMinutes, freeMinutesRemaining, DEFAULT_DAY_AVAILABILITY } from '@/core/calendar/availability';
import type { ContextLookup, ScoredChunk } from '@/services/rag/retrieval';
import { bm25Retriever } from '@/services/rag/retrieval';
import { tokenize, termFrequencies } from '@/services/rag/tokenize';
import { correctCourseQuery } from '@/services/local/querySpelling';

const lookup: ContextLookup = { subjects: new Map(), chapters: new Map(), documents: new Map() };
function chunks(text: string): ScoredChunk[] {
  return [{ score: 1, matchedTerms: [], chunk: { id: 'c1', documentId: 'd1', subjectId: 's1', chapterId: 'ch1', index: 0, text, charStart: 0, charEnd: text.length, pageStart: 2, pageEnd: 2, termFreq: {}, tokenCount: 10, embedding: null } }];
}

describe('tuteur local', () => {
  it('retrouve puis explique la question exacte de la capture, malgré nefs', () => {
    const text = 'Le nerf ophtalmique de Willis\n• Il entre dans le sinus caverneux.\n• Il se divise en trois branches :\n§ Nerf naso-ciliaire\n§ Nerf frontal\n§ Nerf lacrymal';
    const source = chunks(text)[0]!.chunk;
    source.termFreq = termFrequencies(tokenize(text));
    source.tokenCount = tokenize(text).length;
    const query = correctCourseQuery('Je en comprends pas les nefs de willis', [text]);
    const retrieved = bm25Retriever.retrieve(query, [source], 8);
    const answer = answerWithStudyTutor(query, retrieved, lookup);
    expect(answer?.text).toContain('lacrymal');
    expect(answer?.citations.length).toBeGreaterThan(0);
  });
  it('ne corrige ni un mot connu ni une faute ambiguë ni une question sans ancrage', () => {
    expect(correctCourseQuery('nerf optique', ['nerf ophtalmique'])).toBe('nerf optique');
    expect(correctCourseQuery('nerf mare', ['nerf mère rare'])).toBe('nerf mare');
    expect(correctCourseQuery('nefs', ['nerf'])).toBe('nefs');
  });
  it('corrige la séparation fautive et ne réaffiche pas les mots déformés en titre', () => {
    const question = 'Je ne comprends pas les nerfsd e willis';
    expect(resolveStudyQuestion(question)).toBe('Je ne comprends pas les nerfs de willis');
    const answer = answerWithStudyTutor(question, chunks('Le nerf ophtalmique de Willis\n• Il chemine par le canal interne.\n• Il entre dans le sinus caverneux.\n• Il se divise en trois branches :\n§ Nerf naso-ciliaire\n§ Nerf frontal\n§ Nerf lacrymal'), lookup);
    expect(answer).not.toBeNull();
    expect(answer!.text).toContain('lacrymal');
    expect(answer!.text).not.toContain('nerfsd');
    expect(answer!.text).not.toContain('Réponse locale');
    expect(answer!.text).not.toContain('Le moteur local');
    expect(answer!.citations.length).toBeGreaterThan(0);
  });
  it('demande de clarifier optique/ophtalmique au lieu de changer de nerf', () => {
    const answer = answerWithStudyTutor('je comprends pas les nerfs optique', chunks('Le nerf ophtalmique de Willis se divise en trois branches : nerf naso-ciliaire, nerf frontal et nerf lacrymal.'), lookup);
    expect(answer?.text).toContain('Les deux noms ne sont pas interchangeables');
    expect(answer?.citations).toEqual([]);
    expect(answer?.text).not.toContain('FMA');
  });
  it('explique la structure du cours avec sources et sans réseau', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'));
    try {
      const answer = answerWithStudyTutor('Explique le nerf trijumeau', chunks('Le nerf trijumeau possède trois branches : ophtalmique, maxillaire et mandibulaire.'), lookup);
      expect(answer?.text).toContain('trois branches');
      expect(answer?.text).toContain('À toi');
      expect(answer?.citations[0]?.page).toBe(2);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
  it('ne fabrique pas de réponse pour un sujet absent', () => {
    expect(answerWithStudyTutor('Explique le nerf optique', chunks('Le nerf facial possède plusieurs branches.'), lookup)).toBeNull();
  });
  it('rattache les questions courtes au sujet précédent, sans détourner un nouveau sujet', () => {
    expect(resolveStudyQuestion('Et son trajet ?', 'nerf lacrymal')).toContain('nerf lacrymal');
    expect(resolveStudyQuestion('Explique le nerf frontal', 'nerf lacrymal')).toBe('Explique le nerf frontal');
    expect(resolveStudyQuestion('Et son trajet ?')).toBe('Et son trajet ?');
    expect(studyTopic('Explique le nerf lacrymal')).toBe('nerf lacrymal');
  });
});

describe('disponibilités qui se chevauchent', () => {
  const day = { ...DEFAULT_DAY_AVAILABILITY,
    morning: { ...DEFAULT_DAY_AVAILABILITY.morning, enabled: true, start: '10:00', end: '14:00' },
    afternoon: { ...DEFAULT_DAY_AVAILABILITY.afternoon, enabled: true, start: '12:00', end: '16:00' },
    evening: { ...DEFAULT_DAY_AVAILABILITY.evening, enabled: false },
  };
  it('ne compte chaque minute qu’une fois', () => expect(availableMinutes(day)).toBe(360));
  it('retire les heures passées et les événements sans double comptage', () => {
    expect(freeMinutesRemaining(day, [{ start: '12:00', end: '13:30' }], 11 * 60)).toBe(210);
  });
});
