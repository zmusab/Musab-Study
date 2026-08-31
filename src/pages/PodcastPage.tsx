import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { Stagger, StaggerItem } from '@/components/motion/Motion';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  SegmentedControl,
  Select,
  Spinner,
  useToast,
} from '@/components/ui';
import { useChapters, useSubjects } from '@/hooks/useSubjects';
import { usePodcastEpisodes } from '@/hooks/usePodcasts';
import { db } from '@/data/db';
import { listChunks } from '@/data/repositories/documents';
import { savePodcastEpisode } from '@/data/repositories/podcasts';
import { generatePodcastEpisode, InsufficientCourseContentError } from '@/services/podcast/pipeline';
import { LENGTH_PRESETS, formatDuration } from '@/services/podcast/plan';
import { hasApiKey } from '@/services/ai/settings';
import { aiOrchestrator } from '@/services/ai/orchestrator';
import { useProfile } from '@/hooks/useProfile';
import { formatRelativePast } from '@/lib/date';
import type { ContextLookup } from '@/services/rag/retrieval';
import type { ID, PodcastLength } from '@/types';

const LENGTH_SEGMENTS = [
  { value: 'quick' as const, label: LENGTH_PRESETS.quick.label, icon: '⚡' },
  { value: 'normal' as const, label: LENGTH_PRESETS.normal.label, icon: '📚' },
  { value: 'deep' as const, label: LENGTH_PRESETS.deep.label, icon: '🧠' },
];

const STAGE_LABELS: Record<string, string> = {
  analyse: 'Analyse du cours et sélection des notions importantes…',
  plan: 'Construction du plan de l’épisode…',
  dialogue: 'Écriture du dialogue entre les deux personnages…',
  validation: 'Vérification des sources citées…',
};

export function PodcastPage() {
  const subjects = useSubjects();
  const profile = useProfile();
  const { notify } = useToast();

  const [subjectId, setSubjectId] = useState<ID | ''>('');
  const [chapterId, setChapterId] = useState<ID | 'all'>('all');
  const [length, setLength] = useState<PodcastLength>('normal');
  const [enrich, setEnrich] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [createdEpisodeId, setCreatedEpisodeId] = useState<ID | null>(null);

  const chapters = useChapters(subjectId || undefined);
  const episodes = usePodcastEpisodes(subjectId || undefined);

  useEffect(() => {
    if (!subjectId && subjects && subjects.length > 0) setSubjectId(subjects[0]!.id);
  }, [subjects, subjectId]);

  useEffect(() => setChapterId('all'), [subjectId]);

  const handleGenerate = async () => {
    if (!subjectId) return;
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour générer un podcast.', 'error');
      return;
    }

    setStage('analyse');
    setCreatedEpisodeId(null);
    try {
      const scopeChapterId = chapterId === 'all' ? null : chapterId;
      const chunks = await listChunks({ subjectId, chapterId: scopeChapterId });

      const [subjectRows, chapterRows, documentRows, subject] = await Promise.all([
        db.subjects.toArray(),
        db.chapters.where('subjectId').equals(subjectId).toArray(),
        db.documents.where('subjectId').equals(subjectId).toArray(),
        db.subjects.get(subjectId),
      ]);
      const lookup: ContextLookup = {
        subjects: new Map(subjectRows.map((row) => [row.id, row])),
        chapters: new Map(chapterRows.map((row) => [row.id, row])),
        documents: new Map(documentRows.map((row) => [row.id, { id: row.id, name: row.name }])),
      };

      const chapterName =
        scopeChapterId ? chapterRows.find((c) => c.id === scopeChapterId)?.name : undefined;
      const title = chapterName ? `${subject?.name} — ${chapterName}` : (subject?.name ?? 'Podcast');

      const episode = await generatePodcastEpisode({
        subjectId,
        chapterId: scopeChapterId,
        title,
        length,
        enrichedWithInternet: enrich,
        chunks,
        lookup,
        program: profile.program || 'dentisterie',
        onStage: setStage,
      });

      await savePodcastEpisode(episode);
      setCreatedEpisodeId(episode.id);
      notify('Épisode généré.', 'success');
    } catch (error) {
      const message =
        error instanceof InsufficientCourseContentError ? error.message : aiOrchestrator.describeAiError(error);
      notify(message, 'error');
    } finally {
      setStage(null);
    }
  };

  if (subjects && subjects.length === 0) {
    return (
      <PageTransition>
        <PageHeader title="Podcast" />
        <EmptyState
          icon={<Icon name="podcast" size={30} />}
          title="Importe d’abord un cours"
          description="Le podcast transforme tes documents en conversation entre deux étudiants. Crée une matière et ajoute un document avant de générer un épisode."
          action={
            <Link to="/cours">
              <Button>Aller aux cours</Button>
            </Link>
          }
        />
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <PageHeader
        title="Podcast"
        subtitle="Une conversation à deux voix, construite à partir de tes cours, avec ses sources vérifiées."
      />

      <Card className="mb-6">
        <h2 className="text-[1.05rem] mb-4">Générer un épisode</h2>
        <div className="flex flex-col gap-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Matière" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              {(subjects ?? []).map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </Select>
            <Select
              label="Portée"
              value={chapterId}
              onChange={(e) => setChapterId(e.target.value as ID | 'all')}
            >
              <option value="all">Toute la matière</option>
              {(chapters ?? []).map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <span className="mb-1.5 block text-[0.78rem] font-semibold text-[var(--ink-soft)]">
              Durée
            </span>
            <SegmentedControl segments={LENGTH_SEGMENTS} value={length} onChange={setLength} size="sm" />
            <p className="mt-1.5 text-[0.78rem] text-[var(--ink-faint)]">
              {LENGTH_PRESETS[length].minMinutes}–{LENGTH_PRESETS[length].maxMinutes} min ·{' '}
              {LENGTH_PRESETS[length].conceptCount} notions couvertes
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-[0.86rem]">
            <input
              type="checkbox"
              checked={enrich}
              onChange={(e) => setEnrich(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            🌐 Enrichir avec Internet (au-delà de tes cours, clairement signalé dans le dialogue)
          </label>

          <Button loading={stage !== null} onClick={handleGenerate}>
            🎙️ Transformer en podcast
          </Button>

          {stage && (
            <p className="flex items-center gap-2 text-[0.83rem] text-[var(--ink-soft)]">
              <Spinner size={14} />
              {STAGE_LABELS[stage] ?? 'Génération…'}
            </p>
          )}

          {createdEpisodeId && (
            <Link to={`/podcast/${createdEpisodeId}`}>
              <Button variant="secondary" block>
                ▶️ Écouter le nouvel épisode
              </Button>
            </Link>
          )}
        </div>
      </Card>

      {episodes === undefined ? null : episodes.length === 0 ? (
        <EmptyState
          icon={<Icon name="podcast" size={30} />}
          title="Aucun épisode pour l’instant"
          description="Génère ton premier podcast avec le formulaire ci-dessus."
        />
      ) : (
        <Stagger className="flex flex-col gap-3">
          {episodes.map((episode) => (
            <StaggerItem key={episode.id}>
              <Link
                to={`/podcast/${episode.id}`}
                className="surface-card flex items-center justify-between gap-3 p-4 transition-colors duration-150 hover:bg-[var(--surface-hover)]"
              >
                <div className="min-w-0">
                  <h3 className="truncate text-[0.95rem]">{episode.title}</h3>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.78rem] text-[var(--ink-faint)]">
                    <span>{formatDuration(episode.estimatedDurationSec)}</span>
                    <span>· {episode.concepts.length} notions</span>
                    <span>· {formatRelativePast(episode.createdAt)}</span>
                  </p>
                </div>
                <Chip color="var(--accent)">{LENGTH_PRESETS[episode.length].label}</Chip>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </PageTransition>
  );
}
