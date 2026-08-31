import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageTransition } from '@/components/layout/PageTransition';
import { Button, Card, Chip, EmptyState, Icon, useConfirm, useToast } from '@/components/ui';
import { TranscriptView } from '@/components/features/podcast/TranscriptView';
import { PlayerControls } from '@/components/features/podcast/PlayerControls';
import { usePodcastEpisode } from '@/hooks/usePodcasts';
import { usePodcastPlayer } from '@/hooks/usePodcastPlayer';
import { deletePodcastEpisode } from '@/data/repositories/podcasts';
import { createFlashcards } from '@/data/repositories/cards';
import { conceptToFlashcard } from '@/services/podcast/toFlashcards';
import { db } from '@/data/db';
import { LENGTH_PRESETS, formatDuration } from '@/services/podcast/plan';

export function PodcastEpisodePage() {
  const { episodeId } = useParams<{ episodeId: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { notify } = useToast();

  const episode = usePodcastEpisode(episodeId);
  const player = usePodcastPlayer(episode ?? null);
  const [creatingCards, setCreatingCards] = useState(false);

  if (episode === null) {
    return (
      <PageTransition>
        <EmptyState
          icon={<Icon name="podcast" size={30} />}
          title="Épisode introuvable"
          action={
            <Link to="/podcast">
              <Button>Retour au podcast</Button>
            </Link>
          }
        />
      </PageTransition>
    );
  }
  if (!episode) return null;

  const sourceDocuments = [...new Set(episode.concepts.flatMap((c) => c.citations.map((cit) => cit.documentName)))];

  const handleCreateFlashcards = async () => {
    const ok = await confirm({
      title: `Créer ${episode.concepts.length} flashcard(s) ?`,
      description:
        'Une carte par notion abordée dans cet épisode, avec la réponse tirée directement de tes extraits de cours cités.',
      confirmLabel: 'Créer les cartes',
    });
    if (!ok) return;

    setCreatingCards(true);
    try {
      await createFlashcards(episode.concepts.map((concept) => conceptToFlashcard(concept, episode)));
      notify(`${episode.concepts.length} carte(s) ajoutée(s) à ta bibliothèque.`, 'success');
    } finally {
      setCreatingCards(false);
    }
  };

  const handleToggleImportant = async (conceptId: string) => {
    const updated = episode.concepts.map((concept) =>
      concept.id === conceptId
        ? { ...concept, importance: (concept.importance === 3 ? 2 : 3) as 1 | 2 | 3 }
        : concept,
    );
    await db.podcastEpisodes.update(episode.id, { concepts: updated });
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Supprimer cet épisode ?',
      confirmLabel: 'Supprimer',
      destructive: true,
    });
    if (!ok) return;
    player.pause();
    await deletePodcastEpisode(episode.id);
    notify('Épisode supprimé.', 'info');
    navigate('/podcast');
  };

  return (
    <PageTransition>
      <Link
        to="/podcast"
        className="mb-4 inline-flex items-center gap-1.5 text-[0.85rem] text-[var(--ink-soft)] transition-colors hover:text-[var(--ink)]"
      >
        <span aria-hidden>←</span> Podcast
      </Link>

      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip color="var(--accent)">{LENGTH_PRESETS[episode.length].label}</Chip>
          <Chip>{formatDuration(episode.estimatedDurationSec)}</Chip>
          {episode.enrichedWithInternet && <Chip color="var(--success)">🌐 Enrichi</Chip>}
        </div>
        <h1 className="mt-2 text-[1.5rem] leading-tight">{episode.title}</h1>
      </header>

      <div className="mb-5">
        <PlayerControls player={player} totalDurationSec={episode.estimatedDurationSec} />
      </div>

      <Card className="mb-5">
        <h2 className="mb-3 text-[0.95rem]">Notions abordées</h2>
        <ul className="flex flex-col gap-2">
          {episode.concepts.map((concept) => (
            <li key={concept.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[0.87rem]">
                {concept.isPitfall && <span title="Piège fréquent">⚠️</span>}
                {concept.label}
              </span>
              <button
                type="button"
                aria-label="Marquer comme importante"
                onClick={() => handleToggleImportant(concept.id)}
                className="text-[1.1rem] transition-transform active:scale-90"
              >
                {concept.importance === 3 ? '⭐' : '☆'}
              </button>
            </li>
          ))}
        </ul>
        {sourceDocuments.length > 0 && (
          <p className="mt-3 border-t border-[var(--line)] pt-3 text-[0.78rem] text-[var(--ink-faint)]">
            📚 Sources : {sourceDocuments.join(', ')}
          </p>
        )}
      </Card>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="secondary" loading={creatingCards} onClick={handleCreateFlashcards}>
          🃏 Créer des flashcards
        </Button>
        <Button variant="danger" onClick={handleDelete}>
          Supprimer l’épisode
        </Button>
      </div>

      <h2 className="mb-3 text-[0.95rem]">Transcription</h2>
      <TranscriptView
        episode={episode}
        activeIndex={player.currentIndex}
        onSelectSegment={player.seekToSegment}
      />
    </PageTransition>
  );
}
