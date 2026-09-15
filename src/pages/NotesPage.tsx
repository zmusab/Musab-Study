import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { FadeUp, Stagger, StaggerItem } from '@/components/motion/Motion';
import { Button, Card, EmptyState, Icon, Input, Select, Swatch, useConfirm } from '@/components/ui';
import { NoteEditorModal } from '@/components/features/notes/NoteEditorModal';
import { NoteFlashcardDraftsModal } from '@/components/features/notes/NoteFlashcardDraftsModal';
import { useAllNotes } from '@/hooks/useNotes';
import { useSubjects } from '@/hooks/useSubjects';
import { deleteNote } from '@/data/repositories/notes';
import { filterNotes, noteExcerpt, sortNotesByRecent, EMPTY_NOTE_FILTER, type NoteFilter } from '@/core/notes';
import { formatRelativePast } from '@/lib/date';
import type { ID, Note } from '@/types';

/**
 * NOTES — créer, organiser, rechercher et exploiter ses notes de cours.
 *
 * Une note appartient toujours à une matière (le modèle `Note` existant
 * l'exige — voir `types/index.ts`), avec un chapitre optionnel au sein de
 * cette matière. Les notes prises depuis le lecteur PDF (`documentId` non
 * nul) apparaissent ici comme les autres : cette page est la vue
 * d'ensemble, `NotesPanel` (dans le lecteur) reste la prise de note rapide
 * liée à une page précise, inchangée.
 */
export function NotesPage() {
  const notes = useAllNotes();
  const subjects = useSubjects();
  const chapters = useLiveQuery(() => db.chapters.toArray(), []);
  const documents = useLiveQuery(() => db.documents.toArray(), []);
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filter, setFilter] = useState<NoteFilter>(EMPTY_NOTE_FILTER);
  const [editing, setEditing] = useState<{ note: Note | null; defaultSubjectId: ID | null; defaultChapterId: ID | null } | null>(
    null,
  );
  const [flashcardsFor, setFlashcardsFor] = useState<Note | null>(null);

  const subjectById = useMemo(() => new Map((subjects ?? []).map((subject) => [subject.id, subject])), [subjects]);
  const chapterById = useMemo(() => new Map((chapters ?? []).map((chapter) => [chapter.id, chapter])), [chapters]);
  const documentNameById = useMemo(
    () => new Map((documents ?? []).map((document) => [document.id, document.name])),
    [documents],
  );

  const subjectChapters = useMemo(
    () => (chapters ?? []).filter((chapter) => chapter.subjectId === filter.subjectId),
    [chapters, filter.subjectId],
  );

  // Liens entrants — depuis une matière/un chapitre (?subject=/&chapter=) ou
  // depuis la recherche globale (?open=). Consommés une seule fois : l'URL
  // ne doit pas rouvrir la même note à chaque re-rendu. Seul `?open=` a
  // besoin des notes chargées (pour retrouver LA note visée) : `?subject=`/
  // `?chapter=`/`?new=` s'appliquent immédiatement, sans attendre `notes` —
  // sinon, tant que `useLiveQuery` n'a pas encore résolu au premier rendu,
  // l'effet sortirait avant même de lire l'URL, et ne se redéclencherait
  // jamais puisque `notes` n'entrait pas dans ses dépendances.
  useEffect(() => {
    const subjectParam = searchParams.get('subject');
    const chapterParam = searchParams.get('chapter');
    const openParam = searchParams.get('open');
    const newParam = searchParams.get('new');
    if (!subjectParam && !chapterParam && !openParam && !newParam) return;

    if (subjectParam || chapterParam) {
      setFilter((current) => ({ ...current, subjectId: subjectParam ?? current.subjectId, chapterId: chapterParam ?? current.chapterId }));
    }

    if (openParam) {
      // Notes pas encore chargées : on retentera dès qu'elles le seront
      // (`notes` est dans les dépendances ci-dessous), sans effacer l'URL
      // maintenant — sinon la note visée ne serait jamais ouverte.
      if (!notes) return;
      const target = notes.find((note) => note.id === openParam);
      if (target) setEditing({ note: target, defaultSubjectId: null, defaultChapterId: null });
    } else if (newParam && subjectParam) {
      setEditing({ note: null, defaultSubjectId: subjectParam, defaultChapterId: chapterParam });
    }

    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, notes]);

  const visibleNotes = useMemo(() => {
    if (!notes) return [];
    return sortNotesByRecent(filterNotes(notes, filter));
  }, [notes, filter]);

  const removeNote = async (note: Note) => {
    const ok = await confirm({
      title: 'Supprimer cette note ?',
      description: `« ${note.title} » sera définitivement supprimée.`,
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (ok) await deleteNote(note.id);
  };

  if (!subjects || !notes || !chapters) return null;

  if (subjects.length === 0) {
    return (
      <PageTransition>
        <PageHeader title="Notes" />
        <EmptyState
          icon={<Icon name="notes" size={30} />}
          mark="pH critique 5,5"
          title="Les notes se rangent par matière"
          description="Crée d'abord une matière : chaque note lui est associée, avec un chapitre optionnel."
          action={
            <Link to="/cours">
              <Button>Créer ma première matière</Button>
            </Link>
          }
        />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <PageHeader
        title="Notes"
        subtitle="Tes notes de cours — créées, organisées et retrouvables par matière et chapitre."
        action={
          <Button
            size="sm"
            onClick={() => setEditing({ note: null, defaultSubjectId: filter.subjectId, defaultChapterId: filter.chapterId })}
            data-notes-create
          >
            <Icon name="plus" size={15} /> Nouvelle note
          </Button>
        }
      />

      <FadeUp className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <Input
          className="sm:flex-1"
          label="Recherche"
          value={filter.search}
          onChange={(event) => setFilter((current) => ({ ...current, search: event.target.value }))}
          placeholder="Titre ou contenu…"
          data-notes-search
        />
        <Select
          label="Matière"
          value={filter.subjectId ?? ''}
          onChange={(event) =>
            setFilter((current) => ({ ...current, subjectId: event.target.value || null, chapterId: null }))
          }
        >
          <option value="">Toutes les matières</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </Select>
        <Select
          label="Chapitre"
          value={filter.chapterId ?? ''}
          disabled={!filter.subjectId}
          onChange={(event) => setFilter((current) => ({ ...current, chapterId: event.target.value || null }))}
        >
          <option value="">{filter.subjectId ? 'Tous les chapitres' : 'Choisis une matière'}</option>
          {subjectChapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.name}
            </option>
          ))}
        </Select>
      </FadeUp>

      {notes.length === 0 ? (
        <EmptyState
          icon={<Icon name="notes" size={30} />}
          title="Aucune note pour l'instant"
          description="Crée ta première note, ou prends-en une depuis un document ouvert dans le lecteur."
          action={
            <Button onClick={() => setEditing({ note: null, defaultSubjectId: subjects[0]?.id ?? null, defaultChapterId: null })}>
              Créer ma première note
            </Button>
          }
        />
      ) : visibleNotes.length === 0 ? (
        <p className="px-1 py-8 text-center text-[0.85rem] text-[var(--ink-faint)]" data-notes-empty-filtered>
          Aucune note ne correspond à cette recherche ou à ce filtre.
        </p>
      ) : (
        <Stagger className="flex flex-col gap-3">
          {visibleNotes.map((note) => {
            const subject = subjectById.get(note.subjectId);
            const chapter = note.chapterId ? chapterById.get(note.chapterId) : null;
            return (
              <StaggerItem key={note.id}>
                <Card className="flex flex-col gap-2" data-note-item data-note-id={note.id}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setEditing({ note, defaultSubjectId: null, defaultChapterId: null })}
                      data-note-open
                    >
                      <p className="truncate text-[0.98rem] font-medium">{note.title}</p>
                      <p className="mt-1 whitespace-pre-wrap text-[0.85rem] leading-relaxed text-[var(--ink-soft)]">
                        {noteExcerpt(note.text)}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeNote(note)}
                      aria-label={`Supprimer « ${note.title} »`}
                      data-touch-target
                      data-note-delete
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)]"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.78rem] text-[var(--ink-faint)]">
                    {subject && (
                      <Link
                        to={`/cours/${subject.id}`}
                        className="flex items-center gap-1.5 hover:text-[var(--accent)]"
                        data-note-subject-link
                      >
                        <Swatch color={subject.color} size={8} />
                        {subject.name}
                      </Link>
                    )}
                    {chapter && <span>· {chapter.name}</span>}
                    {note.documentId && (
                      <span>· depuis {documentNameById.get(note.documentId) ?? 'un document'}</span>
                    )}
                    <span>· modifiée {formatRelativePast(note.updatedAt)}</span>
                  </div>

                  <div className="flex flex-wrap gap-2 border-t border-[var(--line)] pt-2.5">
                    <Button size="sm" variant="secondary" onClick={() => setEditing({ note, defaultSubjectId: null, defaultChapterId: null })}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setFlashcardsFor(note)} data-note-flashcards-open>
                      <Icon name="sparkles" size={14} /> Créer des flashcards avec l’IA
                    </Button>
                  </div>
                </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}

      {editing && (
        <NoteEditorModal
          open
          onClose={() => setEditing(null)}
          note={editing.note}
          subjects={subjects}
          chapters={chapters}
          defaultSubjectId={editing.defaultSubjectId}
          defaultChapterId={editing.defaultChapterId}
        />
      )}
      {flashcardsFor && (
        <NoteFlashcardDraftsModal open onClose={() => setFlashcardsFor(null)} note={flashcardsFor} />
      )}
    </PageTransition>
  );
}
