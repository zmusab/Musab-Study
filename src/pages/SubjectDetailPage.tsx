import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  Swatch,
  useConfirm,
  useToast,
} from '@/components/ui';
import { DocumentImporter } from '@/components/features/courses/DocumentImporter';
import { DocumentThumbnail } from '@/components/features/courses/DocumentThumbnail';
import {
  useChapters,
  useSubject,
  useSubjectDocumentsByChapter,
  useSubjectOverviews,
} from '@/hooks/useSubjects';
import { createChapter, deleteChapter, deleteSubject } from '@/data/repositories/subjects';
import { deleteDocument } from '@/data/repositories/documents';
import { springSoft } from '@/components/motion/transitions';
import { formatRelativePast } from '@/lib/date';
import type { ID } from '@/types';

/** Détail d'une matière : chapitres, documents, importation. */
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

  const [openChapter, setOpenChapter] = useState<ID | null>(null);
  const [importingInto, setImportingInto] = useState<ID | null>(null);
  const [addingChapter, setAddingChapter] = useState(false);
  const [chapterName, setChapterName] = useState('');

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

  const handleAddChapter = async () => {
    if (chapterName.trim().length === 0) return;
    const chapter = await createChapter(subjectId, chapterName);
    setChapterName('');
    setAddingChapter(false);
    setOpenChapter(chapter.id);
    notify(`Chapitre « ${chapter.name} » ajouté.`, 'success');
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

  return (
    <PageTransition>
      <Link
        to="/cours"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.85rem] text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
      >
        <span aria-hidden>←</span> Cours
      </Link>

      <header className="mb-6">
        <div className="flex items-center gap-2.5">
          <Swatch color={subject.color} size={12} />
          <h1 className="text-[1.75rem] leading-tight">{subject.name}</h1>
        </div>
        {stats && (
          <p className="mt-1.5 text-[0.88rem] text-[var(--ink-soft)]">
            {stats.chapters} chapitre(s) · {stats.documents} document(s) · {stats.cards} carte(s)
          </p>
        )}
      </header>

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
            const isOpen = openChapter === chapter.id;

            return (
              <StaggerItem key={chapter.id}>
                <Card padded={false}>
                  <button
                    type="button"
                    data-touch-target
                    onClick={() => setOpenChapter(isOpen ? null : chapter.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-3 p-5 text-left"
                  >
                    <div className="min-w-0">
                      <h2 className="truncate text-[1rem]">{chapter.name}</h2>
                      <p className="mt-0.5 text-[0.8rem] text-[var(--ink-soft)]">
                        {documents.length === 0
                          ? 'Aucun document'
                          : `${documents.length} document(s)`}
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
                                  className="flex items-center gap-3 rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3 py-2.5"
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
                                        <span>· ajouté {formatRelativePast(document.createdAt)}</span>
                                      </p>
                                    </div>
                                  </Link>
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
    </PageTransition>
  );
}
