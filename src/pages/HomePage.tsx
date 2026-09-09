import { cloneElement, isValidElement, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { PageTransition } from '@/components/layout/PageTransition';
import { FadeUp, Stagger, StaggerItem } from '@/components/motion/Motion';
import { Button, Card, Chip, EmptyState, Icon, Input } from '@/components/ui';
import { useProfile } from '@/hooks/useProfile';
import { useDashboard } from '@/hooks/useDashboard';
import { hasApiKey } from '@/services/ai/settings';
import { useToast } from '@/components/ui';
import { dayKey, daysBetweenDayKeys } from '@/lib/date';

/**
 * Accueil — centre de contrôle quotidien, pas un tableau de bord de
 * statistiques. Chaque section répond à une seule question (que faire, et
 * pourquoi) et repose entièrement sur `useDashboard`, qui ne dérive que des
 * tables réelles — aucun chiffre ici n'est inventé ou arbitraire.
 */

const AI_SUGGESTIONS = [
  'Explique-moi mon cours',
  'Interroge-moi',
  'Crée mes flashcards',
  'Qu’est-ce que je dois réviser ?',
];

function ProgressBar({ value, max, color = 'var(--accent)' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function eventTimingLabel(days: number): string {
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Demain';
  return `Dans ${days} jours`;
}

const EVENT_ICONS: Record<string, string> = {
  exam: '📝',
  course: '📚',
  task: '✅',
  review: '🧠',
};

export function HomePage() {
  const profile = useProfile();
  const data = useDashboard();
  const navigate = useNavigate();
  const { notify } = useToast();
  const [aiInput, setAiInput] = useState('');

  const handleAskAi = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (!hasApiKey()) {
      notify('Ajoute ta clé API dans Paramètres pour utiliser l’assistant.', 'error');
      return;
    }
    navigate(`/ia?prompt=${encodeURIComponent(trimmed)}`);
  };

  if (data === undefined) return null;

  if (!data.hasAnySubject) {
    return (
      <PageTransition>
        <FadeUp>
          <h1 className="text-[1.9rem] leading-tight">
            {profile.name ? `Bonjour ${profile.name}` : 'Bonjour'}
          </h1>
        </FadeUp>
        <div className="mt-6">
          <EmptyState
            icon={<Icon name="courses" size={30} />}
            title="Commence par créer une matière"
            description="Une fois tes cours importés, l’accueil te dira chaque jour ce qu’il faut réviser et pourquoi — à partir de tes vraies données, jamais d’exemples."
            action={
              <Link to="/cours">
                <Button>Créer ma première matière</Button>
              </Link>
            }
          />
        </div>
      </PageTransition>
    );
  }

  const { dueTriage, weakConcepts, recentDocuments, upcomingEvents, nextExam, dailySummary, dailyCardGoal } = data;

  // Personnalisation : sans révision urgente, mettre en avant les cours et le
  const prioritizeSession = dueTriage.total > 0;

  const weakConceptsCard = weakConcepts.length > 0 && (
    <StaggerItem key="weak">
      <Card>
        <p className="flex items-center gap-2 text-[0.95rem] font-semibold">
          Ton attention aujourd’hui
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {weakConcepts.map((w) => (
            <li key={w.cardId} className="border-l-2 border-[var(--warning)] pl-3">
              <p className="text-[0.9rem] font-medium">{w.question}</p>
              <p className="mt-0.5 text-[0.82rem] text-[var(--ink-soft)]">{w.reason}</p>
            </li>
          ))}
        </ul>
        <Link
          to={`/revisions?cards=${weakConcepts.map((w) => w.cardId).join(',')}`}
          className="mt-4 inline-block text-[0.85rem] font-semibold text-[var(--accent)] hover:underline"
        >
          Voir mes points faibles →
        </Link>
      </Card>
    </StaggerItem>
  );

  const coursesCard = (
    <StaggerItem key="courses">
      <Card>
        <p className="text-[0.95rem] font-semibold">Continuer à apprendre</p>
        {recentDocuments.length === 0 ? (
          <p className="mt-2 text-[0.85rem] text-[var(--ink-soft)]">
            Ouvre un document depuis Cours pour le retrouver ici.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {recentDocuments.map((doc) => (
              <li key={doc.id}>
                <Link to={`/document/${doc.id}`} className="block rounded-[var(--radius-control)] transition-colors hover:bg-[var(--surface-2)] -mx-1 px-1 py-0.5">
                  <p className="truncate text-[0.88rem] font-medium">{doc.name}</p>
                  {doc.pageCount && (
                    <>
                      <p className="mt-0.5 text-[0.75rem] text-[var(--ink-faint)]">
                        Page {doc.lastReadPage} / {doc.pageCount}
                      </p>
                      <div className="mt-1.5">
                        <ProgressBar value={doc.lastReadPage} max={doc.pageCount} color="var(--nav-turquoise)" />
                      </div>
                    </>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </StaggerItem>
  );


  const upcomingCard = (
    <StaggerItem key="upcoming">
      <Card>
        <p className="flex items-center gap-2 text-[0.95rem] font-semibold">
          À venir
        </p>
        {upcomingEvents.length === 0 ? (
          <p className="mt-2 text-[0.85rem] text-[var(--ink-soft)]">Aucune échéance enregistrée.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {upcomingEvents.map((event) => {
              const days = daysBetweenDayKeys(dayKey(), event.day);
              return (
                <li key={event.id} className="flex items-center gap-2.5 text-[0.85rem]">
                  <span aria-hidden>{EVENT_ICONS[event.kind] ?? '📌'}</span>
                  <span className="min-w-0 flex-1 truncate">{event.title}</span>
                  <Chip>{eventTimingLabel(days)}</Chip>
                </li>
              );
            })}
          </ul>
        )}
        {nextExam && nextExam.masteryPct !== null && (
          <p className="mt-3 text-[0.78rem] text-[var(--ink-faint)]">
            {nextExam.masteryPct}% des notions associées sont actuellement maîtrisées.
          </p>
        )}
      </Card>
    </StaggerItem>
  );

  const orderedCards = (
    prioritizeSession
      ? [weakConceptsCard, coursesCard, upcomingCard]
      : [coursesCard, weakConceptsCard, upcomingCard]
  ).filter((card): card is ReactElement<{ className?: string }> => isValidElement(card));

  // Une dernière carte seule sur sa ligne casserait la respiration voulue —
  // elle s'étend sur les deux colonnes plutôt que de laisser un vide.
  const secondaryCards = orderedCards.map((card, index) =>
    index === orderedCards.length - 1 && orderedCards.length % 2 === 1
      ? cloneElement(card, { className: cn(card.props.className, 'md:col-span-2') })
      : card,
  );

  return (
    <PageTransition>
      <Stagger className="flex flex-col gap-5">
        <StaggerItem>
          <h1 className="text-[1.9rem] leading-tight">
            {profile.name ? `Bonjour ${profile.name}` : 'Bonjour'}
          </h1>
          <p className="mt-1.5 text-[1rem] text-[var(--ink-soft)]">{data.greeting}</p>
        </StaggerItem>

        {/* Session recommandée — l'élément principal de l'accueil. */}
        <StaggerItem>
          <Card className="border-[var(--accent)]/30 bg-[var(--accent-tint)]">
            <p className="flex items-center gap-2 text-[0.85rem] font-semibold text-[var(--accent-ink)]">
              Session recommandée
            </p>

            {dueTriage.total === 0 ? (
              <p className="mt-3 text-[0.95rem] text-[var(--ink-soft)]">
                Aucune carte due pour l’instant — reviens quand la répétition espacée en aura reprogrammé.
              </p>
            ) : (
              <>
                <p className="mt-2 text-[2rem] font-semibold leading-none">{dueTriage.total} questions</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {dueTriage.atRisk > 0 && <Chip color="var(--danger)">🔴 {dueTriage.atRisk} à risque d’oubli</Chip>}
                  {dueTriage.difficult > 0 && <Chip color="var(--warning)">🟠 {dueTriage.difficult} difficiles</Chip>}
                  {dueTriage.normal > 0 && <Chip color="var(--mastery-2)">🟡 {dueTriage.normal} normales</Chip>}
                </div>
                <p className="mt-2 text-[0.82rem] text-[var(--ink-faint)]">≈ {data.sessionMinutes} min</p>
                <p className="mt-3 text-[0.85rem] leading-relaxed text-[var(--ink-soft)]">
                  Sélectionnées selon ta maîtrise réelle et ton historique de révisions — les notions les
                  moins bien retenues reviennent en premier.
                </p>
                <Link to="/revisions?autostart=1" className="mt-4 block">
                  <Button size="lg" block>
                    Commencer ma session
                  </Button>
                </Link>
              </>
            )}
          </Card>
        </StaggerItem>

        <div className="grid gap-5 md:grid-cols-2">{secondaryCards}</div>

        {/* Résumé de la journée. */}
        <StaggerItem>
          <Card>
            <p className="text-[0.95rem] font-semibold">Aujourd’hui</p>
            <p className="mt-2 text-[1.6rem] font-semibold leading-none">{dailySummary.minutesStudied} min étudiées</p>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-[var(--ink-soft)]">
              <span>{dailySummary.cardsReviewed} cartes révisées</span>
              <span>{dailySummary.documentsOpened} cours ouverts</span>
            </div>
            <div className="mt-4 flex items-center justify-between text-[0.78rem] text-[var(--ink-faint)]">
              <span>Objectif du jour</span>
              <span>
                {dailySummary.cardsReviewed}/{dailyCardGoal} cartes
              </span>
            </div>
            <div className="mt-1.5">
              <ProgressBar value={dailySummary.cardsReviewed} max={dailyCardGoal} color="var(--success)" />
            </div>
          </Card>
        </StaggerItem>

        {/* Accès rapide à l'assistant IA. */}
        <StaggerItem>
          <Card>
            <p className="flex items-center gap-2 text-[0.95rem] font-semibold">
              Que veux-tu faire ?
            </p>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                handleAskAi(aiInput);
              }}
            >
              <Input
                value={aiInput}
                onChange={(event) => setAiInput(event.target.value)}
                placeholder="Demande quelque chose à Musab Study…"
                className="flex-1"
              />
              <Button type="submit" disabled={aiInput.trim().length === 0}>
                Demander
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {AI_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => handleAskAi(suggestion)}
                  className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[0.78rem] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </Card>
        </StaggerItem>
      </Stagger>
    </PageTransition>
  );
}
