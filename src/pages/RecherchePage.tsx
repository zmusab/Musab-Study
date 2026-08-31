import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PageTransition } from '@/components/layout/PageTransition';
import { Stagger, StaggerItem } from '@/components/motion/Motion';
import { EmptyState, Icon, Input, Spinner, type IconName } from '@/components/ui';
import { useSearchIndex } from '@/hooks/useSearchIndex';
import { searchItems, type SearchItemKind, type SearchResult } from '@/services/search';

/**
 * Recherche globale — un seul champ, tout le site.
 *
 * L'« approximation » demandée par l'utilisateur : une faute de frappe
 * (« masster » au lieu de « masséter ») retrouve quand même le bon résultat,
 * via `searchItems` (distance d'édition sur les mots courts, sous-chaîne
 * normalisée sur les corps de texte). Les résultats sont groupés par section
 * plutôt qu'en liste plate : un même terme touche souvent un document, une
 * carte ET une question de quiz, et l'utilisateur cherche un TYPE de contenu
 * autant qu'un mot.
 */

const KIND_ORDER: SearchItemKind[] = [
  'subject',
  'chapter',
  'document',
  'note',
  'flashcard',
  'quiz',
  'podcast',
  'anatomy',
  'calendar',
];

const KIND_META: Record<SearchItemKind, { label: string; plural: string; icon: IconName; color: string }> = {
  subject: { label: 'Matière', plural: 'Matières', icon: 'courses', color: 'var(--nav-turquoise)' },
  chapter: { label: 'Chapitre', plural: 'Chapitres', icon: 'courses', color: 'var(--nav-turquoise)' },
  document: { label: 'Document', plural: 'Documents', icon: 'courses', color: 'var(--nav-turquoise)' },
  note: { label: 'Note', plural: 'Notes', icon: 'notes', color: 'var(--nav-orange)' },
  flashcard: { label: 'Flashcard', plural: 'Flashcards', icon: 'cards', color: 'var(--nav-purple)' },
  quiz: { label: 'Question de quiz', plural: 'Quiz', icon: 'quiz', color: 'var(--nav-rose)' },
  podcast: { label: 'Podcast', plural: 'Podcasts', icon: 'podcast', color: 'var(--nav-green)' },
  anatomy: { label: 'Structure anatomique', plural: 'Anatomie', icon: 'anatomy', color: 'var(--nav-red)' },
  calendar: { label: 'Événement', plural: 'Calendrier', icon: 'calendar', color: 'var(--nav-red)' },
};

function ResultRow({ result }: { result: SearchResult }) {
  const meta = KIND_META[result.kind];
  return (
    <Link
      to={result.to}
      className="surface-card flex items-start gap-3 p-4 transition-colors duration-150 hover:bg-[var(--surface-hover)]"
    >
      <span
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]"
        style={{ color: meta.color, backgroundColor: 'color-mix(in oklab, currentColor 14%, transparent)' }}
      >
        <Icon name={meta.icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.95rem] font-medium">{result.title}</p>
        {result.subtitle && (
          <p className="mt-0.5 truncate text-[0.78rem] text-[var(--ink-faint)]">{result.subtitle}</p>
        )}
        {result.excerpt && (
          <p className="mt-1 line-clamp-2 text-[0.82rem] leading-relaxed text-[var(--ink-soft)]">
            {result.excerpt}
          </p>
        )}
      </div>
    </Link>
  );
}

export function RecherchePage() {
  const index = useSearchIndex();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Le champ reste réactif à chaque frappe ; seul le calcul du score (mot par
  // mot sur le corps de chaque document, potentiellement volumineux) attend
  // une courte pause — sur une grosse bibliothèque de cours, recalculer à
  // chaque caractère tapé donnerait une sensation de saccade.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const results = useMemo(
    () => (index ? searchItems(index, debouncedQuery) : []),
    [index, debouncedQuery],
  );

  const groups = useMemo(() => {
    return KIND_ORDER.map((kind) => ({ kind, items: results.filter((r) => r.kind === kind) })).filter(
      (group) => group.items.length > 0,
    );
  }, [results]);

  const trimmed = query.trim();

  return (
    <PageTransition>
      <PageHeader title="Recherche" subtitle="Cours, notes, flashcards, quiz, podcasts, anatomie, calendrier — tout d'un coup." />

      <div className="relative mb-6">
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-faint)]"
        />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher dans tout le site…"
          className="pl-10"
          aria-label="Recherche"
        />
      </div>

      {index === undefined ? (
        <div className="flex justify-center py-16">
          <Spinner size={22} />
        </div>
      ) : trimmed.length === 0 ? (
        <EmptyState
          icon={<Icon name="search" size={30} />}
          title="Cherche un terme, même approximatif"
          description="Une faute de frappe n'empêche rien : « masster » retrouve « masséter ». La recherche porte sur tes matières, chapitres, documents, notes, flashcards, quiz, podcasts, structures anatomiques et événements du calendrier."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Icon name="search" size={30} />}
          title={`Aucun résultat pour « ${trimmed} »`}
          description="Vérifie l'orthographe ou essaie un terme plus court — la recherche reste stricte sur les mots très différents pour éviter les faux résultats."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => {
            const meta = KIND_META[group.kind];
            return (
              <section key={group.kind}>
                <h2
                  className="mb-2 flex items-center gap-1.5 text-[0.78rem] font-semibold tracking-wide"
                  style={{ color: meta.color }}
                >
                  <Icon name={meta.icon} size={14} />
                  {group.items.length > 1 ? meta.plural : meta.label}
                </h2>
                <Stagger className="flex flex-col gap-2">
                  {group.items.map((result) => (
                    <StaggerItem key={result.id}>
                      <ResultRow result={result} />
                    </StaggerItem>
                  ))}
                </Stagger>
              </section>
            );
          })}
        </div>
      )}
    </PageTransition>
  );
}
