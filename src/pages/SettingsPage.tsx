import { useEffect, useRef, useState } from 'react';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { Stagger, StaggerItem } from '@/components/motion/Motion';
import {
  Button,
  Card,
  CardSubtitle,
  CardTitle,
  Input,
  SegmentedControl,
  Textarea,
  useConfirm,
  useToast,
} from '@/components/ui';
import { AiSettingsCard } from '@/components/features/settings/AiSettingsCard';
import { useProfile } from '@/hooks/useProfile';
import { saveProfile } from '@/data/repositories/profile';
import { useTheme } from '@/hooks/useTheme';
import { exportBackup, importBackup } from '@/services/backup';
import { convertLegacyDump, isLegacyDump } from '@/services/legacyImport';
import { clearAllData } from '@/data/db';
import type { ThemePreference } from '@/types';
import { agree, plural } from '@/lib/plural';
import { reindexAllDocuments } from '@/data/repositories/documents';
import { downloadBlob } from '@/lib/download';
import {
  exportBackupArchive,
  importBackupArchive,
  looksLikeArchive,
} from '@/services/backupArchive';

const THEME_SEGMENTS = [
  { value: 'light' as const, label: 'Clair', icon: '☀️' },
  { value: 'dark' as const, label: 'Sombre', icon: '🌙' },
  { value: 'system' as const, label: 'Système', icon: '🖥️' },
];

function downloadJson(data: unknown, filename: string): void {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename);
}

/** « 12,4 Mo » — une taille de fichier se lit, elle ne se compte pas en octets. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

export function SettingsPage() {
  const [reindexing, setReindexing] = useState(false);

  /**
   * Retraite toute la bibliothèque avec l'extraction corrigée. Le décompte
   * annoncé est le nombre RÉEL de documents modifiés : dire « c'est fait »
   * quand rien n'a changé laisserait croire à une correction qui n'a pas eu
   * lieu.
   */
  const handleReindex = async () => {
    setReindexing(true);
    try {
      const { changed, total } = await reindexAllDocuments();
      notify(
        changed === 0
          ? total === 0
            ? 'Aucun document à retraiter.'
            : 'Tes documents étaient déjà à jour.'
          : `${plural(changed, 'document')} sur ${total} ${agree(changed, 'remis')} à niveau.`,
        changed === 0 ? 'info' : 'success',
      );
    } finally {
      setReindexing(false);
    }
  };

  const profile = useProfile();
  const { preference, setPreference } = useTheme();
  const { notify } = useToast();
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ name: '', university: '', section: '', program: '', goals: '' });
  const [busy, setBusy] = useState(false);

  // Le profil arrive de façon asynchrone : on hydrate le formulaire à l'arrivée.
  useEffect(() => {
    setForm({
      name: profile.name,
      university: profile.university,
      section: profile.section,
      program: profile.program,
      goals: profile.goals,
    });
  }, [profile]);

  const handleSaveProfile = async () => {
    await saveProfile(form);
    notify('Profil enregistré.', 'success');
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const bundle = await exportBackup();
      downloadJson(bundle, `musab-study-${bundle.exportedAt.slice(0, 10)}.json`);
      notify('Sauvegarde téléchargée.', 'success');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Export COMPLET, PDF d'origine compris. Séparé de l'export JSON et non
   * substitué à lui : l'archive pèse le poids réel des documents, ce qui n'a
   * pas de sens pour une sauvegarde rapide et régulière. Le décompte annoncé
   * est celui des fichiers RÉELLEMENT joints, jamais le nombre de documents.
   */
  const handleExportArchive = async () => {
    setBusy(true);
    try {
      const { blob, files, bytes } = await exportBackupArchive();
      downloadBlob(blob, `musab-study-complet-${new Date().toISOString().slice(0, 10)}.zip`);
      notify(
        files === 0
          ? `Sauvegarde téléchargée (${formatBytes(bytes)}). Aucun PDF d’origine à joindre.`
          : `Sauvegarde complète téléchargée : ${plural(files, 'PDF', 'PDF')} joints, ${formatBytes(bytes)}.`,
        'success',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    const ok = await confirm({
      title: 'Remplacer toutes tes données ?',
      description:
        'L’import écrase le contenu actuel de l’application par celui du fichier. Exporte d’abord une sauvegarde si tu as un doute.',
      confirmLabel: 'Importer',
      destructive: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      // Le FORMAT est reconnu au contenu, pas à l'extension : un fichier
      // renommé, ou téléchargé sous un autre nom, reste lisible.
      if (await looksLikeArchive(file)) {
        const report = await importBackupArchive(file);
        notify(
          `Import réussi : ${plural(report.subjects, 'matière')}, ${plural(report.flashcards, 'carte')}, ${plural(report.reviewLogs, 'révision')}, ${plural(report.files, 'PDF', 'PDF')} ${agree(report.files, 'restauré')}.`,
          'success',
        );
        return;
      }

      const parsed: unknown = JSON.parse(await file.text());
      const bundle = isLegacyDump(parsed)
        ? convertLegacyDump(parsed)
        : (parsed as Awaited<ReturnType<typeof exportBackup>>);

      if (!Array.isArray(bundle.subjects)) throw new Error('Format non reconnu');

      const report = await importBackup(bundle);
      notify(
        `Import réussi : ${plural(report.subjects, 'matière')}, ${plural(report.flashcards, 'carte')}, ${plural(report.reviewLogs, 'révision')}.`,
        'success',
      );
    } catch {
      notify('Fichier illisible ou format non reconnu.', 'error');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleReset = async () => {
    const ok = await confirm({
      title: 'Effacer toutes les données ?',
      description: 'Cours, cartes, historique de révision, notes et calendrier seront supprimés définitivement de cet appareil.',
      confirmLabel: 'Tout effacer',
      destructive: true,
    });
    if (!ok) return;
    await clearAllData();
    notify('Toutes les données ont été effacées.', 'info');
  };

  return (
    <PageTransition>
      <PageHeader title="Paramètres" />

      <Stagger className="flex flex-col gap-4">
        <StaggerItem>
          <Card>
            <CardTitle>Profil</CardTitle>
            <div className="mt-4 flex flex-col gap-3.5">
              <Input
                label="Prénom"
                value={form.name}
                placeholder="Musab"
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Input
                  label="Université"
                  value={form.university}
                  onChange={(event) => setForm({ ...form, university: event.target.value })}
                />
                <Input
                  label="Section"
                  value={form.section}
                  onChange={(event) => setForm({ ...form, section: event.target.value })}
                />
              </div>
              <Input
                label="Programme"
                value={form.program}
                onChange={(event) => setForm({ ...form, program: event.target.value })}
              />
              <Textarea
                label="Objectifs"
                value={form.goals}
                placeholder="Ex. Réussir la session de janvier avec mention"
                onChange={(event) => setForm({ ...form, goals: event.target.value })}
              />
              <Button onClick={handleSaveProfile}>Enregistrer le profil</Button>
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card>
            <CardTitle>Apparence</CardTitle>
            <CardSubtitle>
              « Système » suit le réglage jour/nuit de ton iPad automatiquement.
            </CardSubtitle>
            <div className="mt-4">
              <SegmentedControl
                segments={THEME_SEGMENTS}
                value={preference}
                onChange={(value: ThemePreference) => setPreference(value)}
              />
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <AiSettingsCard />
        </StaggerItem>


        <StaggerItem>
          <Card>
            <CardTitle>Retraiter mes cours</CardTitle>
            <CardSubtitle>
              L’extraction des PDF rend à tes documents la mise en page que le PDF avait
              aplatie (titres, puces, accents détachés, en-têtes répétés). Sans cette
              structure, l’assistant répond « absent de tes cours » sur des sujets pourtant
              traités. Cette remise à niveau se fait désormais TOUTE SEULE au démarrage : tu
              n’as rien à faire. Ce bouton ne sert plus qu’à la relancer à la main, si tu veux
              t’en assurer — il ne touche ni à tes flashcards ni à ton historique.
            </CardSubtitle>
            <div className="mt-4">
              <Button loading={reindexing} onClick={handleReindex} data-settings-reindex>
                Retraiter tous mes documents
              </Button>
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card>
            <CardTitle>Sauvegarde et migration</CardTitle>
            <CardSubtitle>
              Tes données vivent sur cet appareil. Exporte régulièrement — c’est ta seule copie.
              L’import reconnaît les deux formats ci-dessous, ainsi que les sauvegardes de ton
              ancien prototype HTML, historique de révision compris.
            </CardSubtitle>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <Button variant="secondary" loading={busy} onClick={handleExport}>
                Exporter mes données
              </Button>
              <Button variant="secondary" loading={busy} onClick={() => fileInput.current?.click()}>
                Importer une sauvegarde
              </Button>
            </div>
            <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
              Le fichier <code>.json</code> emporte tout ton travail — matières, textes de cours,
              flashcards, notes, historique — mais pas les PDF d’origine. Léger, à exporter
              souvent.
            </p>

            {/*
              L'export COMPLET est une action distincte, pas un remplacement :
              l'archive pèse le poids réel des documents, ce qui n'a pas de sens
              pour une sauvegarde qu'on refait chaque semaine. Le choix reste à
              l'utilisateur, avec la contrepartie écrite.
            */}
            <div className="mt-4 border-t border-[var(--line)] pt-4">
              <Button variant="secondary" loading={busy} onClick={handleExportArchive} data-settings-export-full>
                Exporter tout, PDF compris
              </Button>
              <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
                Une archive <code>.zip</code> qui contient la même sauvegarde ET tes PDF
                d’origine. Plus lourde, mais c’est la seule qui te permette de changer
                d’appareil sans rien réimporter à la main.
              </p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json,application/zip,.zip"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImportFile(file);
              }}
            />
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <Button variant="danger" size="sm" onClick={handleReset}>
                Effacer toutes les données
              </Button>
            </div>
          </Card>
        </StaggerItem>
      </Stagger>
    </PageTransition>
  );
}
