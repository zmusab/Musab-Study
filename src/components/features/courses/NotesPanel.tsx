import { useState } from 'react';
import { Button, Icon, Textarea } from '@/components/ui';
import { useConfirm } from '@/components/ui';
import { useDocumentNotes } from '@/hooks/useNotes';
import { createNote, deleteNote } from '@/data/repositories/notes';
import type { ID } from '@/types';

/**
 * Notes prises depuis le lecteur PDF — chacune liée à la page affichée au
 * moment où elle est écrite (`documentId` + `page`), pour qu'un clic dessus
 * ramène exactement au passage d'origine.
 */
export function NotesPanel({
  subjectId,
  chapterId,
  documentId,
  currentPage,
  onJumpToPage,
  onClose,
}: {
  subjectId: ID;
  chapterId: ID | null;
  documentId: ID;
  currentPage: number;
  onJumpToPage: (page: number) => void;
  onClose: () => void;
}) {
  const notes = useDocumentNotes(documentId);
  const confirm = useConfirm();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const addNote = async () => {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      await createNote({
        subjectId,
        chapterId,
        documentId,
        page: currentPage,
        title: `Page ${currentPage}`,
        text,
      });
      setDraft('');
    } finally {
      setSaving(false);
    }
  };

  const removeNote = async (id: ID) => {
    const ok = await confirm({ title: 'Supprimer cette note ?', destructive: true, confirmLabel: 'Supprimer' });
    if (ok) await deleteNote(id);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--line)] p-3">
        <p className="text-[0.88rem] font-medium">Mes notes {notes ? `— ${notes.length}` : ''}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer les notes"
          data-touch-target
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-soft)] hover:bg-[var(--surface-2)]"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-2 border-b border-[var(--line)] p-3">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Ajouter une note sur la page ${currentPage}…`}
          rows={3}
        />
        <Button size="sm" onClick={() => void addNote()} disabled={draft.trim().length === 0 || saving}>
          <Icon name="plus" size={15} /> Ajouter une note
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!notes || notes.length === 0 ? (
          <p className="px-1 text-[0.82rem] text-[var(--ink-faint)]">
            Aucune note sur ce document pour l'instant.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id} className="rounded-[var(--radius-control)] bg-[var(--surface-2)] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => note.page !== null && onJumpToPage(note.page)}
                    className="min-w-0 flex-1 text-left"
                  >
                    {note.page !== null && (
                      <span className="text-[0.72rem] font-semibold text-[var(--accent)]">Page {note.page}</span>
                    )}
                    <p className="mt-0.5 whitespace-pre-wrap text-[0.82rem] leading-relaxed text-[var(--ink-soft)]">
                      {note.text}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeNote(note.id)}
                    aria-label="Supprimer la note"
                    data-touch-target
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)]"
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
