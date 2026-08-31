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
  Select,
  Textarea,
  useConfirm,
  useToast,
} from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { saveProfile } from '@/data/repositories/profile';
import { useTheme } from '@/hooks/useTheme';
import {
  AVAILABLE_MODELS,
  getApiKey,
  getModel,
  maskApiKey,
  setApiKey,
  setModel,
} from '@/services/ai/settings';
import { exportBackup, importBackup } from '@/services/backup';
import { convertLegacyDump, isLegacyDump } from '@/services/legacyImport';
import { clearAllData } from '@/data/db';
import type { ThemePreference } from '@/types';

const THEME_SEGMENTS = [
  { value: 'light' as const, label: 'Clair', icon: '☀️' },
  { value: 'dark' as const, label: 'Sombre', icon: '🌙' },
  { value: 'system' as const, label: 'Système', icon: '🖥️' },
];

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Sans révocation, le blob resterait en mémoire pour toute la session.
  URL.revokeObjectURL(url);
}

export function SettingsPage() {
  const profile = useProfile();
  const { preference, setPreference } = useTheme();
  const { notify } = useToast();
  const confirm = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({ name: '', university: '', section: '', program: '', goals: '' });
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [model, setModelState] = useState(getModel);
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

  useEffect(() => {
    setStoredKey(getApiKey());
  }, []);

  const handleSaveProfile = async () => {
    await saveProfile(form);
    notify('Profil enregistré.', 'success');
  };

  const handleSaveKey = () => {
    const trimmed = apiKeyDraft.trim();
    if (trimmed.length === 0) {
      notify('Colle ta clé API avant d’enregistrer.', 'error');
      return;
    }
    setApiKey(trimmed);
    setStoredKey(trimmed);
    setApiKeyDraft('');
    notify('Clé API enregistrée sur cet appareil.', 'success');
  };

  const handleRemoveKey = async () => {
    const ok = await confirm({
      title: 'Supprimer la clé API ?',
      description: 'Les fonctions IA seront désactivées jusqu’à ce que tu en saisisses une nouvelle.',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!ok) return;
    setApiKey(null);
    setStoredKey(null);
    notify('Clé API supprimée.', 'info');
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
      const parsed: unknown = JSON.parse(await file.text());
      const bundle = isLegacyDump(parsed)
        ? convertLegacyDump(parsed)
        : (parsed as Awaited<ReturnType<typeof exportBackup>>);

      if (!Array.isArray(bundle.subjects)) throw new Error('Format non reconnu');

      const report = await importBackup(bundle);
      notify(
        `Import réussi : ${report.subjects} matière(s), ${report.flashcards} carte(s), ${report.reviewLogs} révision(s).`,
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
          <Card>
            <CardTitle>Assistant IA</CardTitle>
            <CardSubtitle>
              Ta clé API est enregistrée <strong>uniquement sur cet appareil</strong>. Elle n’est
              jamais envoyée ailleurs qu’à Anthropic, et n’est pas incluse dans tes sauvegardes.
            </CardSubtitle>

            <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--warning)] bg-[var(--warning-tint)] px-3.5 py-3 text-[0.83rem] leading-relaxed text-[var(--ink)]">
              <strong>À savoir :</strong> cette application est hébergée en statique, sans serveur.
              La clé est donc lisible par le code de la page. C’est acceptable pour un usage
              personnel, mais n’utilise pas une clé partagée avec d’autres personnes, et révoque-la
              depuis la console Anthropic si tu la penses exposée.
            </div>

            <div className="mt-4 flex flex-col gap-3.5">
              {storedKey ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3">
                  <span className="font-mono text-[0.83rem] text-[var(--ink-soft)]">
                    {maskApiKey(storedKey)}
                  </span>
                  <Button size="sm" variant="danger" onClick={handleRemoveKey}>
                    Supprimer
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    label="Clé API Anthropic"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="sk-ant-…"
                    value={apiKeyDraft}
                    hint={
                      <>
                        À créer sur{' '}
                        <a
                          href="https://console.anthropic.com/settings/keys"
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline underline-offset-2"
                        >
                          console.anthropic.com
                        </a>
                        .
                      </>
                    }
                    onChange={(event) => setApiKeyDraft(event.target.value)}
                  />
                  <Button onClick={handleSaveKey}>Enregistrer la clé</Button>
                </>
              )}

              <Select
                label="Modèle"
                value={model}
                hint={AVAILABLE_MODELS.find((entry) => entry.id === model)?.hint}
                onChange={(event) => {
                  setModelState(event.target.value);
                  setModel(event.target.value);
                }}
              >
                {AVAILABLE_MODELS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem>
          <Card>
            <CardTitle>Sauvegarde et migration</CardTitle>
            <CardSubtitle>
              Tes données vivent sur cet appareil. Exporte régulièrement — c’est ta seule copie.
              L’import accepte aussi les sauvegardes de ton ancien prototype HTML, historique de
              révision compris.
            </CardSubtitle>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <Button variant="secondary" loading={busy} onClick={handleExport}>
                Exporter mes données
              </Button>
              <Button variant="secondary" loading={busy} onClick={() => fileInput.current?.click()}>
                Importer une sauvegarde
              </Button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
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
