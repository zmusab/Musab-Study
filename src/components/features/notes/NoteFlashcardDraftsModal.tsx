import { useState } from 'react';
import { Button, Modal, Select, Textarea, useToast } from '@/components/ui';
import { createFlashcard } from '@/data/repositories/cards';
import { aiOrchestrator } from '@/services/ai/orchestrator';
import { hasApiKey } from '@/services/ai/settings';
import { generateNoteCardDrafts, InsufficientNoteContentError, type NoteCardDraft } from '@/services/notes/flashcards';
import type { Note } from '@/types';

const COUNT_OPTIONS = [3, 5, 8];

/**
 * « CRÉER DES FLASHCARDS AVEC L'IA » depuis une note.
 *
 * L'IA ne fait que PROPOSER (`generateNoteCardDrafts`, déjà vérifiées contre
 * le texte réel de la note — voir `services/notes/flashcards.ts`). Rien
 * n'est enregistré tant que l'utilisateur n'a pas accepté CHAQUE carte
 * individuellement ; il peut aussi la modifier avant d'accepter, ou la
 * refuser. Une carte acceptée devient une VRAIE flashcard, créée par
 * `createFlashcard` — le même chemin que les cartes manuelles, avec la même
 * répétition espacée SM-2 (`initialSchedulingState`).
 */
export function NoteFlashcardDraftsModal({
  open,
  onClose,
  note,
}: {
  open: boolean;
  onClose: () => void;
  note: Note;
}) {
  const { notify } = useToast();
  const [count, setCount] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [drafts, setDrafts] = useState<NoteCardDraft[]>([]);
  const [index, setIndex] = useState(0);
  const [accepted, setAccepted] = useState(0);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setDrafts([]);
    setIndex(0);
    setAccepted(0);
  };

  const close = () => {
    reset();
    onClose();
  };

  const start = async () => {
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour générer des flashcards avec l’IA.', 'error');
      return;
    }
    setGenerating(true);
    try {
      const generated = await generateNoteCardDrafts({ note, count });
      if (generated.length === 0) {
        notify('Cette note ne permet pas de proposer de flashcard fiable pour l’instant.', 'error');
        reset();
      } else {
        setDrafts(generated);
        setIndex(0);
        setAccepted(0);
      }
    } catch (error) {
      if (error instanceof InsufficientNoteContentError) notify(error.message, 'error');
      else notify(aiOrchestrator.describeAiError(error), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const current = drafts[index];

  const updateCurrent = (patch: Partial<Pick<NoteCardDraft, 'question' | 'answer'>>) => {
    setDrafts((list) => list.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  const accept = async () => {
    if (!current || saving) return;
    setSaving(true);
    try {
      await createFlashcard({
        subjectId: note.subjectId,
        chapterId: note.chapterId,
        question: current.question,
        answer: current.answer,
        // Sourcée depuis une note, pas depuis le corpus indexé en chunks :
        // `sourceChunkIds` reste vide, honnêtement — voir services/notes/flashcards.ts.
        origin: 'ai',
        sourceChunkIds: [],
      });
      setAccepted((n) => n + 1);
      setIndex((i) => i + 1);
    } finally {
      setSaving(false);
    }
  };

  const reject = () => setIndex((i) => i + 1);

  const done = drafts.length > 0 && index >= drafts.length;

  return (
    <Modal open={open} onClose={close} title="Créer des flashcards avec l’IA" size="lg">
      <div className="flex flex-col gap-4" data-note-flashcards>
        <p className="text-[0.85rem] leading-relaxed text-[var(--ink-soft)]">
          L’IA propose des cartes à partir du texte de cette note. Rien n’est enregistré tant que tu n’as pas accepté
          chaque carte — tu peux aussi la modifier avant, ou la refuser.
        </p>

        {drafts.length === 0 && !generating && (
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label="Nombre de propositions"
              value={String(count)}
              onChange={(event) => setCount(Number(event.target.value))}
            >
              {COUNT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} cartes
                </option>
              ))}
            </Select>
            <Button onClick={() => void start()} data-note-generate-flashcards>
              Créer des flashcards avec l’IA
            </Button>
          </div>
        )}

        {generating && (
          <p className="text-[0.85rem] text-[var(--ink-faint)]" data-note-flashcards-generating>
            Génération en cours…
          </p>
        )}

        {current && (
          <div className="surface-card flex flex-col gap-3 p-4" data-note-draft key={index}>
            <p className="text-[0.78rem] font-medium text-[var(--ink-faint)]">
              Proposition {index + 1}/{drafts.length}
            </p>
            <Textarea
              label="Question"
              value={current.question}
              onChange={(event) => updateCurrent({ question: event.target.value })}
              rows={2}
            />
            <Textarea
              label="Réponse"
              value={current.answer}
              onChange={(event) => updateCurrent({ answer: event.target.value })}
              rows={3}
            />
            <p className="text-[0.78rem] leading-relaxed text-[var(--ink-faint)]" data-note-draft-excerpt>
              Basé sur : « {current.excerpt} »
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void accept()} loading={saving} data-note-draft-accept>
                Accepter
              </Button>
              <Button size="sm" variant="ghost" onClick={reject} disabled={saving} data-note-draft-reject>
                Refuser
              </Button>
            </div>
          </div>
        )}

        {done && (
          <p className="text-[0.85rem] text-[var(--ink-soft)]" data-note-flashcards-summary>
            {accepted} carte{accepted > 1 ? 's' : ''} ajoutée{accepted > 1 ? 's' : ''} sur {drafts.length} proposée
            {drafts.length > 1 ? 's' : ''}.
          </p>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={close}>
            Fermer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
