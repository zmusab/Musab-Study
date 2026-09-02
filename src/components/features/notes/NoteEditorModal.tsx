import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Textarea } from '@/components/ui';
import { createNote, updateNote } from '@/data/repositories/notes';
import type { Chapter, ID, Note, Subject } from '@/types';

/**
 * CRÉER / MODIFIER UNE NOTE.
 *
 * Une note issue du lecteur PDF (`note.documentId` non nul, voir
 * `NotesPanel.tsx`) garde sa matière verrouillée : elle appartient à la
 * matière du document d'origine, la changer casserait ce lien. Seuls le
 * titre, le contenu et le chapitre restent modifiables pour ces notes-là.
 */
export function NoteEditorModal({
  open,
  onClose,
  note,
  subjects,
  chapters,
  defaultSubjectId = null,
  defaultChapterId = null,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** `null` = création d'une nouvelle note. */
  note: Note | null;
  subjects: Subject[];
  /** Tous les chapitres de l'application — filtrés ici par la matière choisie. */
  chapters: Chapter[];
  defaultSubjectId?: ID | null;
  defaultChapterId?: ID | null;
  onSaved?: (note: Note) => void;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [subjectId, setSubjectId] = useState<ID | null>(null);
  const [chapterId, setChapterId] = useState<ID | null>(null);
  const [saving, setSaving] = useState(false);

  // Réinitialise le formulaire à chaque ouverture — nouvelle note ou note différente.
  useEffect(() => {
    if (!open) return;
    setTitle(note?.title ?? '');
    setText(note?.text ?? '');
    setSubjectId(note?.subjectId ?? defaultSubjectId ?? subjects[0]?.id ?? null);
    setChapterId(note?.chapterId ?? defaultChapterId ?? null);
  }, [open, note, defaultSubjectId, defaultChapterId, subjects]);

  const subjectLocked = note?.documentId != null;
  const subjectChapters = chapters.filter((chapter) => chapter.subjectId === subjectId);

  const save = async () => {
    if (!subjectId || text.trim().length === 0 || saving) return;
    setSaving(true);
    const finalTitle = title.trim() || 'Note sans titre';
    const finalText = text.trim();
    try {
      if (note) {
        const effectiveSubjectId = subjectLocked ? note.subjectId : subjectId;
        await updateNote(note.id, {
          title: finalTitle,
          text: finalText,
          subjectId: effectiveSubjectId,
          chapterId,
        });
        onSaved?.({
          ...note,
          title: finalTitle,
          text: finalText,
          subjectId: effectiveSubjectId,
          chapterId,
          updatedAt: new Date().toISOString(),
        });
      } else {
        const created = await createNote({ subjectId, chapterId, title: finalTitle, text: finalText });
        onSaved?.(created);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={note ? 'Modifier la note' : 'Nouvelle note'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} data-note-cancel>
            Annuler
          </Button>
          <Button
            onClick={() => void save()}
            loading={saving}
            disabled={!subjectId || text.trim().length === 0}
            data-note-save
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-note-editor>
        <Input
          label="Titre"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Titre de la note"
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Matière"
            value={subjectId ?? ''}
            disabled={subjectLocked}
            onChange={(event) => {
              setSubjectId(event.target.value || null);
              setChapterId(null);
            }}
          >
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
          <Select label="Chapitre" value={chapterId ?? ''} onChange={(event) => setChapterId(event.target.value || null)}>
            <option value="">Aucun chapitre</option>
            {subjectChapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.name}
              </option>
            ))}
          </Select>
        </div>
        {subjectLocked && (
          <p className="-mt-2 text-[0.78rem] text-[var(--ink-faint)]">
            Cette note vient du lecteur PDF : sa matière reste celle du document d'origine.
          </p>
        )}

        <Textarea
          label="Contenu"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          className="min-h-[14rem]"
          placeholder="Écris ta note ici…"
        />
      </div>
    </Modal>
  );
}
