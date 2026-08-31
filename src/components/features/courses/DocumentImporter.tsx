import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRef, useState } from 'react';
import { Button, Input, Textarea, useToast } from '@/components/ui';
import { addDocument } from '@/data/repositories/documents';
import { describeExtraction, extractPdfText, PdfExtractionError } from '@/services/pdf/extract';
import { springSoft } from '@/components/motion/transitions';
import type { ID } from '@/types';

/**
 * Importation d'un document dans un chapitre.
 *
 * Le PDF est extrait dans le navigateur AVEC une progression réelle page par
 * page : sur un cours de 200 pages l'extraction prend plusieurs secondes, et
 * une interface figée donne l'impression d'un plantage.
 *
 * Le texte extrait est ensuite affiché et MODIFIABLE avant l'enregistrement.
 * Les PDF universitaires contiennent souvent des en-têtes et des numéros de
 * page répétés ; pouvoir les retirer améliore directement la qualité des
 * réponses de l'IA et des cartes générées.
 *
 * Modifier ce texte invalide sa correspondance page par page (les offsets
 * calculés à l'extraction ne s'appliquent plus après une coupe) : un
 * document dont le texte a été édité n'aura donc pas de numéro de page dans
 * les citations de l'IA, plutôt qu'un numéro faux — la même règle que pour
 * une affirmation non sourcée, appliquée ici à la pagination.
 */
export function DocumentImporter({
  subjectId,
  chapterId,
  onDone,
}: {
  subjectId: ID;
  chapterId: ID;
  onDone?: () => void;
}) {
  const { notify } = useToast();
  const reduced = useReducedMotion();
  const fileInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [rawText, setRawText] = useState('');
  const [progress, setProgress] = useState<{ page: number; pageCount: number } | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pageOffsets, setPageOffsets] = useState<number[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFile = async (file: File) => {
    setProgress({ page: 0, pageCount: 0 });
    setText('');
    setPdfFile(null);
    if (name.trim().length === 0) setName(file.name.replace(/\.pdf$/i, ''));

    try {
      const result = await extractPdfText(file, setProgress);
      const description = describeExtraction(result);
      setText(result.text);
      setRawText(result.text);
      setPageCount(result.pageCount);
      setPageOffsets(result.pageOffsets);
      // Le PDF original est gardé tel quel — c'est LUI que l'utilisateur
      // consultera dans le lecteur, `text` ne sert qu'à l'IA.
      setPdfFile(file);
      notify(description.message, description.tone);
    } catch (error) {
      const message =
        error instanceof PdfExtractionError
          ? error.message
          : "L'extraction a échoué. Copie-colle le texte à la main.";
      notify(message, 'error');
    } finally {
      setProgress(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleSave = async () => {
    const trimmed = text.trim();
    if (trimmed.length < 50) {
      notify('Le texte est trop court pour être utile (50 caractères minimum).', 'error');
      return;
    }

    const edited = trimmed !== rawText.trim();

    setSaving(true);
    try {
      await addDocument({
        subjectId,
        chapterId,
        name,
        text: trimmed,
        source: pageCount === null ? 'paste' : 'pdf',
        pageCount,
        pageOffsets: edited ? [] : pageOffsets,
        file: pdfFile ?? undefined,
      });
      notify(
        pdfFile ? 'PDF conservé et indexé pour l’IA.' : 'Document ajouté et indexé pour l’IA.',
        'success',
      );
      setName('');
      setText('');
      setRawText('');
      setPageCount(null);
      setPageOffsets([]);
      setPdfFile(null);
      onDone?.();
    } finally {
      setSaving(false);
    }
  };

  const textEdited = pdfFile !== null && text.trim() !== rawText.trim();

  const percent =
    progress && progress.pageCount > 0
      ? Math.round((progress.page / progress.pageCount) * 100)
      : null;

  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Nom du document"
        placeholder="Ex. Muscles masticateurs"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />

      <div>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        <Button
          variant="secondary"
          block
          disabled={progress !== null}
          onClick={() => fileInput.current?.click()}
        >
          {progress !== null ? 'Extraction en cours…' : 'Importer un PDF'}
        </Button>
      </div>

      <AnimatePresence>
        {progress !== null && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={reduced ? { duration: 0 } : springSoft}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between text-[0.8rem] text-[var(--ink-soft)]">
              <span>
                {progress.pageCount > 0
                  ? `Page ${progress.page} sur ${progress.pageCount}`
                  : 'Ouverture du fichier…'}
              </span>
              {percent !== null && <span className="font-mono">{percent}%</span>}
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <motion.div
                className="h-full rounded-full bg-[var(--accent)]"
                animate={{ width: `${percent ?? 8}%` }}
                transition={{ duration: reduced ? 0 : 0.25 }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Textarea
        label="Texte du document (couche IA)"
        hint={
          textEdited
            ? `${text.length.toLocaleString('fr-FR')} caractères — texte modifié : les citations de l’IA pour ce document n’auront pas de numéro de page (la correspondance page par page ne s’applique plus après une coupe).`
            : text.length > 0
              ? `${text.length.toLocaleString('fr-FR')} caractères — relis et retire les en-têtes ou numéros de page répétés si besoin. Le PDF original, lui, reste intact et consultable tel quel.`
              : 'Importe un PDF ci-dessus, ou colle directement le texte de ton cours.'
        }
        rows={7}
        value={text}
        placeholder="Colle ici le texte de ton cours…"
        onChange={(event) => setText(event.target.value)}
      />

      <Button loading={saving} disabled={text.trim().length < 50} onClick={handleSave}>
        Enregistrer le document
      </Button>
    </div>
  );
}
