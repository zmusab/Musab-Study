import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { PageTransition } from '@/components/layout/PageTransition';
import { Stagger, StaggerItem } from '@/components/motion/Motion';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  Input,
  Modal,
  SegmentedControl,
  Select,
  Swatch,
  useConfirm,
  useToast,
  type Segment,
} from '@/components/ui';
import { DocumentImporter } from '@/components/features/courses/DocumentImporter';
import { DocumentThumbnail } from '@/components/features/courses/DocumentThumbnail';
import { DocumentFileSize } from '@/components/features/courses/DocumentFileSize';
import { NotionsTab } from '@/components/features/courses/NotionsTab';
import { NoteEditorModal } from '@/components/features/notes/NoteEditorModal';
import {
  useChapters,
  useSubject,
  useSubjectDocumentsByChapter,
  useSubjectOverviews,
} from '@/hooks/useSubjects';
import { useSubjectNotes } from '@/hooks/useNotes';
import { createChapter, deleteChapter, deleteSubject, updateChapter, updateSubject } from '@/data/repositories/subjects';
import { deleteDocument, moveDocument } from '@/data/repositories/documents';
import { deleteNote } from '@/data/repositories/notes';
import { listCards } from '@/data/repositories/cards';
import { db } from '@/data/db';
import { subjectProgress } from '@/core/progress';
import { springSoft } from '@/components/motion/transitions';
import { formatRelativePast } from '@/lib/date';
import type { Chapter, ID } from '@/types';
import { plural } from '@/lib/plural';

type TabKey = 'documents' | 'notes' | 'notions' | 'flashcards' | 'quiz' | 'progression';

const TABS: Segment<TabKey>[] = [
  { value: 'documents', label: 'Documents' },
  { value: 'notes', label: 'Notes' },
  { value: 'notions', label: 'Notions' },
  { value: 'flashcards', label: 'Flashcards' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'progression', label: 'Progression' },
];

/** Détail d'une matière — le centre documentaire : documents, notes, notions, et les portes d'entrée vers flashcards/quiz/progression. */
export function SubjectDetailPage() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const navigate = useNavigate();
  const { notify } = useToast();
  const confirm = useConfirm();
  const reduced = useReducedMotion();

  const subject = useSubject(subjectId);
  const chapters = useChapters(subjectId);
  const documentsByChapter = useSubjectDocumentsByChapter(subjectId);
  const overviews = useSubjectOverviews();
  const notes = useSubjectNotes(subjectId);
  const analyses = useLiveQuery(
    () => (subjectId ? db.chapterAnalyses.where('subjectId').equals(subjectId).toArray() : []),
    [subjectId],
  );
  const cards = useLiveQuery(() => (subjectId ? listCards(subjectId) : []), [subjectId]);
  const reviewLogs = useLiveQuery(() => subjectId ? db.reviewLogs.where('subjectId').equals(subjectId).toArray() : [], [subjectId]);

  // Document le plus récemment ouvert de CETTE matière — alimente « Continuer ».
  const recentDocument = useLiveQuery(async () => {
    if (!subjectId) return null;
    const docs = await db.documents.where('subjectId').equals(subjectId).toArray();
    const opened = docs.filter((d) => d.lastOpenedAt !== null);
    opened.sort((a, b) => (b.lastOpenedAt ?? '').localeCompare(a.lastOpenedAt ?? ''));
    return opened[0] ?? null;
  }, [subjectId]);

  const [tab, setTab] = useState<TabKey>('documents');
  const [openChapter, setOpenChapter] = useState<ID | null>(null);
  const [importingInto, setImportingInto] = useState<ID | null>(null);
  const [addingChapter, setAddingChapter] = useState(false);
  const [chapterName, setChapterName] = useState('');
  const [renamingSubject, setRenamingSubject] = useState(false);
  const [subjectNameDraft, setSubjectNameDraft] = useState('');
  const [renamingChapter, setRenamingChapter] = useState<Chapter | null>(null);
  const [chapterNameDraft, setChapterNameDraft] = useState('');
  const [creatingNote, setCreatingNote] = useState(false);

  if (subject === null) {
    return (
      <PageTransition>
        <EmptyState
          icon={<Icon name="courses" size={30} />}
          title="Matière introuvable"
          description="Elle a peut-être été supprimée."
          action={<Button onClick={() => navigate('/cours')}>Retour aux cours</Button>}
        />
      </PageTransition>
    );
  }

  if (!subject || !subjectId) return null;

  const stats = overviews?.[subjectId];
  const measured = cards && reviewLogs ? subjectProgress([subject], chapters ?? [], cards, reviewLogs)[0] : null;
  const allDocuments = Object.values(documentsByChapter ?? {}).flat();
  const totalPages = allDocuments.reduce((sum, doc) => sum + (doc.pageCount ?? 0), 0);
  const notionCount = analyses?.reduce((sum, a) => sum + a.notions.length, 0) ?? 0;
  const documentNameById = new Map(allDocuments.map((doc) => [doc.id, doc.name]));

  const handleAddChapter = async () => {
    if (chapterName.trim().length === 0) return;
    const chapter = await createChapter(subjectId, chapterName);
    setChapterName('');
    setAddingChapter(false);
    setOpenChapter(chapter.id);
    notify(`Chapitre « ${chapter.name} » ajouté.`, 'success');
  };

  const handleRenameSubject = async () => {
    const name = subjectNameDraft.trim();
    if (name.length === 0) return;
    await updateSubject(subjectId, { name });
    setRenamingSubject(false);
    notify('Matière renommée.', 'success');
  };

  const handleRenameChapter = async () => {
    if (!renamingChapter) return;
    const name = chapterNameDraft.trim();
    if (name.length === 0) return;
    await updateChapter(renamingChapter.id, { name });
    setRenamingChapter(null);
    notify('Chapitre renommé.', 'success');
  };

  const handleMoveDocument = async (documentId: ID, newChapterId: ID) => {
    await moveDocument(documentId, newChapterId);
    notify('Document déplacé.', 'success');
  };

  const handleDeleteChapter = async (id: ID, name: string) => {
    const ok = await confirm({
      title: `Supprimer « ${name} » ?`,
      description:
        'Les documents de ce chapitre seront supprimés. Tes cartes et tes notes sont conservées, elles perdront simplement leur lien vers ce chapitre.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!ok) return;
    await deleteChapter(id);
    notify('Chapitre supprimé.', 'info');
  };

  const handleDeleteSubject = async () => {
    const ok = await confirm({
      title: `Supprimer « ${subject.name} » ?`,
      description:
        'Chapitres, documents, cartes, questions, notes et historique de révision de cette matière seront définitivement supprimés.',
      confirmLabel: 'Tout supprimer',
      destructive: true,
    });
    if (!ok) return;
    await deleteSubject(subjectId);
    notify(`« ${subject.name} » supprimée.`, 'info');
    navigate('/cours');
  };

  const handleDeleteDocument = async (id: ID, name: string) => {
    const ok = await confirm({
      title: `Supprimer « ${name} » ?`,
      description: 'L’IA ne pourra plus s’appuyer sur ce document.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!ok) return;
    await deleteDocument(id);
    notify('Document supprimé.', 'info');
  };

  const handleDeleteNote = async (id: ID) => {
    const ok = await confirm({ title: 'Supprimer cette note ?', destructive: true, confirmLabel: 'Supprimer' });
    if (!ok) return;
    await deleteNote(id);
  };

  return (
    <PageTransition>
      <Link
        to="/cours"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.85rem] text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
      >
        <span aria-hidden>←</span> Cours
      </Link>

      <header className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Swatch color={subject.color} size={12} />
            <h1 className="text-[1.75rem] leading-tight">{subject.name}</h1>
            <button
              type="button"
              aria-label="Renommer la matière"
              data-touch-target
              onClick={() => {
                setSubjectNameDraft(subject.name);
                setRenamingSubject(true);
              }}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
            >
              ✏️
            </button>
          </div>
          {recentDocument && (
            <Button size="sm" onClick={() => navigate(`/document/${recentDocument.id}`)}>
              ▶️ Continuer
            </Button>
          )}
        </div>

        {stats && (
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.85rem] text-[var(--ink-soft)]">
            <span>{plural(stats.chapters, 'chapitre')}</span>
            <span>· {plural(stats.documents, 'document')}</span>
            {totalPages > 0 && <span>· {plural(totalPages, 'page')}</span>}
            <span>· {plural(stats.notes, 'note')}</span>
            <span>· {plural(notionCount, 'notion')}</span>
            {recentDocument?.lastOpenedAt && (
              <span>· consulté {formatRelativePast(recentDocument.lastOpenedAt)}</span>
            )}
          </p>
        )}
      </header>

      <SegmentedControl segments={TABS} value={tab} onChange={setTab} className="mb-5" />

      {tab === 'documents' && (
        <>
          {chapters === undefined ? null : chapters.length === 0 ? (
            <EmptyState
              icon={<Icon name="notes" size={30} />}
              title="Ajoute un premier chapitre"
              description="Les chapitres organisent tes cours. Chacun reçoit ses propres documents, et c’est la portée que tu choisiras quand tu interrogeras l’IA ou généreras des cartes."
              action={<Button onClick={() => setAddingChapter(true)}>Ajouter un chapitre</Button>}
            />
          ) : (
            <Stagger className="flex flex-col gap-3">
              {chapters.map((chapter) => {
                const documents = documentsByChapter?.[chapter.id] ?? [];
                const chapterNoteCount = notes?.filter((note) => note.chapterId === chapter.id).length ?? 0;
                const isOpen = openChapter === chapter.id;

                return (
                  <StaggerItem key={chapter.id}>
                    <Card padded={false}>
                      <div className="flex w-full items-center gap-2 p-5">
                        <button
                          type="button"
                          data-touch-target
                          onClick={() => setOpenChapter(isOpen ? null : chapter.id)}
                          aria-expanded={isOpen}
                          className="flex flex-1 items-center justify-between gap-3 text-left"
                        >
                          <div className="min-w-0">
                            <h2 className="truncate text-[1rem]">{chapter.name}</h2>
                            <p className="mt-0.5 text-[0.8rem] text-[var(--ink-soft)]">
                              {documents.length === 0
                                ? 'Aucun document'
                                : plural(documents.length, 'document')}
                            </p>
                          </div>
                          <motion.span
                            aria-hidden
                            className="shrink-0 text-[var(--ink-faint)]"
                            animate={{ rotate: isOpen ? 90 : 0 }}
                            transition={reduced ? { duration: 0 } : springSoft}
                          >
                            ›
                          </motion.span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Renommer « ${chapter.name} »`}
                          data-touch-target
                          onClick={() => {
                            setChapterNameDraft(chapter.name);
                            setRenamingChapter(chapter);
                          }}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                        >
                          ✏️
                        </button>
                      </div>

                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
                            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                            transition={reduced ? { duration: 0 } : springSoft}
                            className="overflow-hidden"
                          >
                            <div className="border-t border-[var(--line)] px-5 py-4">
                              {documents.length > 0 && (
                                <ul className="mb-4 flex flex-col gap-2">
                                  {documents.map((document) => (
                                    <li
                                      key={document.id}
                                      className="flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3 py-2.5"
                                    >
                                      <Link
                                        to={`/document/${document.id}`}
                                        className="flex min-w-0 flex-1 items-center gap-3"
                                      >
                                        <DocumentThumbnail
                                          blob={document.thumbnail}
                                          className="h-14 w-11 shrink-0"
                                        />
                                        <div className="min-w-0">
                                          <p className="truncate text-[0.88rem] font-medium">
                                            {document.name}
                                          </p>
                                          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.75rem] text-[var(--ink-faint)]">
                                            {document.pageCount !== null && (
                                              <span>{document.pageCount} pages</span>
                                            )}
                                            <DocumentFileSize documentId={document.id} />
                                            <span>· ajouté {formatRelativePast(document.createdAt)}</span>
                                          </p>
                                        </div>
                                      </Link>
                                      {chapters.length > 1 && (
                                        <Select
                                          aria-label={`Déplacer « ${document.name} »`}
                                          value={chapter.id}
                                          onChange={(event) => void handleMoveDocument(document.id, event.target.value)}
                                          className="w-auto min-h-9 py-1.5 text-[0.78rem]"
                                        >
                                          {chapters.map((c) => (
                                            <option key={c.id} value={c.id}>
                                              {c.name}
                                            </option>
                                          ))}
                                        </Select>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="danger"
                                        onClick={() => handleDeleteDocument(document.id, document.name)}
                                      >
                                        Suppr.
                                      </Button>
                                    </li>
                                  ))}
                                </ul>
                              )}

                              <div className="flex flex-wrap gap-2">
                                <Button size="sm" onClick={() => setImportingInto(chapter.id)}>
                                  Ajouter un document
                                </Button>
                                <Link
                                  to={`/notes?subject=${subjectId}&chapter=${chapter.id}`}
                                  data-chapter-notes-link
                                >
                                  <Button size="sm" variant="secondary">
                                    <Icon name="notes" size={14} />
                                    {chapterNoteCount > 0 ? `Notes (${chapterNoteCount})` : 'Notes de ce chapitre'}
                                  </Button>
                                </Link>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => handleDeleteChapter(chapter.id, chapter.name)}
                                >
                                  Supprimer le chapitre
                                </Button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </Card>
                  </StaggerItem>
                );
              })}
            </Stagger>
          )}

          {chapters && chapters.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setAddingChapter(true)}>
                Ajouter un chapitre
              </Button>
              <Button variant="danger" onClick={handleDeleteSubject}>
                Supprimer la matière
              </Button>
            </div>
          )}
        </>
      )}

      {tab === 'notes' && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <Link to={`/notes?subject=${subjectId}`} className="text-[0.82rem] text-[var(--ink-soft)] hover:text-[var(--accent)]">
              Voir dans Notes →
            </Link>
            <Button size="sm" onClick={() => setCreatingNote(true)} data-subject-create-note>
              <Icon name="plus" size={15} /> Nouvelle note
            </Button>
          </div>

          {!notes || notes.length === 0 ? (
            <EmptyState
              icon={<Icon name="notes" size={30} />}
              title="Aucune note pour l'instant"
              description="Crée une note, ou ouvre un document et ajoute-en une depuis le lecteur — elle apparaîtra ici, liée à sa page d'origine."
              action={<Button onClick={() => setCreatingNote(true)}>Créer ma première note</Button>}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((note) => (
                <li key={note.id} className="surface-card flex items-start justify-between gap-3 p-4">
                  <button
                    type="button"
                    disabled={note.documentId === null || note.page === null}
                    onClick={() =>
                      note.documentId && note.page && navigate(`/document/${note.documentId}?page=${note.page}`)
                    }
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    {note.documentId && note.page !== null && (
                      <p className="text-[0.72rem] font-semibold text-[var(--accent)]">
                        {documentNameById.get(note.documentId) ?? 'Document'} — page {note.page}
                      </p>
                    )}
                    <p className="mt-0.5 whitespace-pre-wrap text-[0.86rem] leading-relaxed">{note.text}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteNote(note.id)}
                    aria-label="Supprimer la note"
                    data-touch-target
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--danger)]"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === 'notions' && <NotionsTab subjectId={subjectId} chapters={chapters ?? []} />}

      {tab === 'flashcards' && (
        <EmptyState
          icon={<Icon name="cards" size={30} />}
          title="Flashcards de cette matière"
          description={`${plural(stats?.cards ?? 0, 'carte')}, dont ${stats?.dueCards ?? 0} à réviser.`}
          action={
            <Button onClick={() => navigate(`/flashcards?subject=${subjectId}`)}>
              Ouvrir les flashcards
            </Button>
          }
        />
      )}

      {tab === 'quiz' && (
        <EmptyState
          icon={<Icon name="quiz" size={30} />}
          title="Me tester"
          description="Teste les notions de cette matière. Tes réponses enregistrées alimentent ton taux de réussite et tes points faibles."
          action={<Button onClick={() => navigate(`/quiz?scope=subject&subject=${encodeURIComponent(subjectId)}`)}>Commencer un quiz de cette matière</Button>}
        />
      )}


      {tab === 'progression' && (
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-[0.8rem] text-[var(--ink-faint)]">
              Retrouve ici les mêmes mesures que dans ta progression : tes révisions pour l’indice de maîtrise,
              et tes réponses aux quiz et aux cartes pour le taux de réussite. Lire un document seul ne valide pas une acquisition.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[1.4rem] font-semibold">{measured?.masteryPct == null ? 'À mesurer' : `${measured.masteryPct} %`}</p>
                <p className="text-[0.76rem] text-[var(--ink-faint)]">Indice de maîtrise</p>
              </div>
              <div>
                <p className="text-[1.4rem] font-semibold">{stats?.cards ?? 0}</p>
                <p className="text-[0.76rem] text-[var(--ink-faint)]">Cartes</p>
              </div>
              <div>
                <p className="text-[1.4rem] font-semibold">{stats?.dueCards ?? 0}</p>
                <p className="text-[0.76rem] text-[var(--ink-faint)]">À réviser</p>
              </div>
              <div>
                <p className="text-[1.4rem] font-semibold">{measured?.successRate == null ? 'À mesurer' : `${Math.round(measured.successRate * 100)} %`}</p>
                <p className="text-[0.76rem] text-[var(--ink-faint)]">Réussite · {measured?.reviews ?? 0} réponses</p>
              </div>
            </div>
            <Link to={`/progression?subject=${encodeURIComponent(subjectId)}`} className="mt-5 inline-flex min-h-11 items-center rounded-full bg-[var(--accent-tint)] px-4 text-sm font-semibold text-[var(--accent-ink)]">Voir mes chapitres et préparer mon examen →</Link>
          </Card>
        </div>
      )}

      <Modal
        open={addingChapter}
        onClose={() => setAddingChapter(false)}
        title="Nouveau chapitre"
        description="Ex. Muscles masticateurs, Ostéologie du crâne…"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddingChapter(false)}>
              Annuler
            </Button>
            <Button onClick={handleAddChapter}>Ajouter</Button>
          </>
        }
      >
        <Input
          label="Nom du chapitre"
          autoFocus
          value={chapterName}
          onChange={(event) => setChapterName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleAddChapter();
          }}
        />
      </Modal>

      <Modal
        open={renamingSubject}
        onClose={() => setRenamingSubject(false)}
        title="Renommer la matière"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenamingSubject(false)}>
              Annuler
            </Button>
            <Button onClick={handleRenameSubject}>Enregistrer</Button>
          </>
        }
      >
        <Input
          label="Nom"
          autoFocus
          value={subjectNameDraft}
          onChange={(event) => setSubjectNameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleRenameSubject();
          }}
        />
      </Modal>

      <Modal
        open={renamingChapter !== null}
        onClose={() => setRenamingChapter(null)}
        title="Renommer le chapitre"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenamingChapter(null)}>
              Annuler
            </Button>
            <Button onClick={handleRenameChapter}>Enregistrer</Button>
          </>
        }
      >
        <Input
          label="Nom"
          autoFocus
          value={chapterNameDraft}
          onChange={(event) => setChapterNameDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleRenameChapter();
          }}
        />
      </Modal>

      <Modal
        open={importingInto !== null}
        onClose={() => setImportingInto(null)}
        title="Ajouter un document"
        description={
          <>
            Le texte est découpé en fragments citables pour l’IA.{' '}
            <Chip>indexé automatiquement</Chip>
          </>
        }
        size="lg"
      >
        {importingInto && (
          <DocumentImporter
            subjectId={subjectId}
            chapterId={importingInto}
            onDone={() => setImportingInto(null)}
          />
        )}
      </Modal>

      {subject && (
        <NoteEditorModal
          open={creatingNote}
          onClose={() => setCreatingNote(false)}
          note={null}
          subjects={[subject]}
          chapters={chapters ?? []}
          defaultSubjectId={subject.id}
          defaultChapterId={openChapter}
        />
      )}
    </PageTransition>
  );
}
