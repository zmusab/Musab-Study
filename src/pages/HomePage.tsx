import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { PageTransition } from '@/components/layout/PageTransition';
import { notationFor } from '@/components/layout/notations';
import { CountUp } from '@/components/motion/Reveal';
import { FadeUp, Stagger, StaggerItem as MotionItem } from '@/components/motion/Motion';
import { Button, Card, Chip, EmptyState, Icon, Input, Spinner, Swatch } from '@/components/ui';
import { agree, plural } from '@/lib/plural';
import type { IconName } from '@/components/ui/Icon';
import { useProfile } from '@/hooks/useProfile';
import { useDashboard } from '@/hooks/useDashboard';
import { dayKey, daysBetweenDayKeys } from '@/lib/date';
import { formatDuration } from '@/core/progress';

function StaggerItem({ children }: { children: ReactNode }) {
  return <MotionItem replayOnScroll>{children}</MotionItem>;
}

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

function ProgressBar({ value, max, label, color = 'var(--accent)' }: { value: number; max: number; label: string; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

function eventTimingLabel(days: number): string {
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Demain';
  return `Dans ${days} jours`;
}

/*
 * Les échéances portaient un emoji (📝 📚 ✅ 🧠). Sur une page composée en
 * Newsreader et Inter, quatre pictogrammes en couleur d'un tout autre style
 * graphique cassent la ligne : ils appartiennent au clavier du téléphone, pas
 * à l'interface. Le jeu d'icônes du projet dit exactement la même chose, au
 * même trait que le reste.
 */
const EVENT_ICONS: Record<string, IconName> = {
  exam: 'quiz',
  course: 'courses',
  task: 'check',
  review: 'review',
};

export function HomePage() {
  const profile = useProfile();
  const data = useDashboard();
  const navigate = useNavigate();
  const [aiInput, setAiInput] = useState('');

  const handleAskAi = (text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    /*
      Aucun garde-fou sur la clé ici, et c'est une correction.

      La page IA répond sur les cours SANS RÉSEAU (moteur local). Le raccourci
      de l'accueil, lui, refusait la question et renvoyait vers Paramètres :
      la porte était fermée devant une pièce ouverte. On navigue, et c'est la
      page IA qui décide — localement d'abord, l'IA seulement si l'étudiant la
      demande.
    */
    navigate(`/ia?prompt=${encodeURIComponent(trimmed)}`);
  };

  if (data === undefined) {
    return (
      <PageTransition>
        <div className="flex min-h-48 items-center justify-center gap-3 text-[var(--ink-soft)]">
          <Spinner size={22} />
          <p>Chargement de ton espace d’étude…</p>
        </div>
      </PageTransition>
    );
  }

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
            mark="Ca₁₀(PO₄)₆(OH)₂"
            title="Commence par créer une matière"
            description="Une fois tes cours importés, l’accueil te dira chaque jour ce qu’il faut réviser et pourquoi — à partir de tes vraies données, jamais d’exemples."
            action={
              <Button onClick={() => navigate('/cours')}>Créer ma première matière</Button>
            }
          />
          <Card className="mt-6">
            <h2 className="text-base font-semibold">Tu as déjà une sauvegarde ?</h2>
            <p className="mt-2 text-base text-[var(--ink-soft)]">
              Retrouve tes cours et tes révisions depuis les paramètres. Tes données restent enregistrées dans ce navigateur : pense à les exporter régulièrement.
            </p>
            <Link to="/parametres" className="mt-4 inline-flex min-h-11 items-center font-semibold text-[var(--accent)] hover:underline">
              Ouvrir les paramètres de sauvegarde
            </Link>
          </Card>
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
                        <ProgressBar value={doc.lastReadPage} max={doc.pageCount} label={`Lecture de ${doc.name}`} color="var(--nav-turquoise)" />
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
                  <Icon name={EVENT_ICONS[event.kind] ?? 'calendar'} size={16} className="shrink-0 text-[var(--ink-faint)]" />
                  <span className="min-w-0 flex-1 truncate">{event.title}</span>
                  <Chip>{eventTimingLabel(days)}</Chip>
                </li>
              );
            })}
          </ul>
        )}
        {nextExam && nextExam.masteryPct !== null && (
          <p className="mt-3 text-[0.78rem] text-[var(--ink-faint)]">
            {nextExam.event.title} : indice de révision des cartes de la matière de {nextExam.masteryPct} %. Cette estimation ne prédit pas ta note d’examen.
          </p>
        )}
        <Link to="/calendrier" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)] hover:underline">
          Ouvrir mon calendrier
        </Link>
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
          {/* Même surtitre que les autres pages (voir `notations.ts`) : ce sont
              les paliers d'intervalle réels de la répétition espacée. */}
          <p
            aria-hidden
            className="mb-1.5 font-serif text-[0.74rem] italic tracking-[0.06em] text-[var(--ink-faint)] opacity-80"
          >
            {notationFor('/')}
          </p>
          <h1 className="text-[1.9rem] leading-tight">
            {profile.name ? `Bonjour ${profile.name}` : 'Bonjour'}
          </h1>
          <p className="mt-1.5 text-[1rem] text-[var(--ink-soft)]">{data.greeting}</p>
        </StaggerItem>

        {/* Session recommandée — l'élément principal de l'accueil. */}
        <StaggerItem>
          {/*
            Pièce maîtresse de l'accueil : elle doit se distinguer AU PREMIER
            COUP D'ŒIL des cartes secondaires. Un fond teinté ne suffisait pas
            — en thème clair, `--accent-tint` sur `--surface` blanc donnait
            deux cartes presque identiques. Un filet d'accent épais sur le bord
            gauche, comme la marque rouge d'un correcteur, la sépare
            immédiatement sans ajouter de couleur.
          */}
          <Card className="border-l-[3px] border-l-[var(--accent)] bg-[var(--accent-tint)]">
            <p className="flex items-center gap-2 font-serif text-[0.8rem] font-semibold uppercase tracking-[0.1em] text-[var(--accent-ink)]">
              Session recommandée
            </p>

            {dueTriage.total === 0 ? (
              <p className="mt-3 text-[0.95rem] text-[var(--ink-soft)]">
                Aucune carte due pour l’instant — reviens quand la répétition espacée en aura reprogrammé.
              </p>
            ) : (
              <>
                <p className="mt-2 text-[2rem] font-semibold leading-none tabular-nums">
                  <CountUp value={dueTriage.total} /> {agree(dueTriage.total, 'question')}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {/* La pastille de couleur DIT le niveau : le rond emoji qui la
                      précédait le répétait une seconde fois, dans une palette
                      qui n'était pas celle de l'application. */}
                  {dueTriage.atRisk > 0 && (
                    <Chip color="var(--danger)">
                      <Swatch color="var(--danger)" size={7} />
                      {dueTriage.atRisk} à risque d’oubli
                    </Chip>
                  )}
                  {dueTriage.difficult > 0 && (
                    <Chip color="var(--warning)">
                      <Swatch color="var(--warning)" size={7} />
                      {dueTriage.difficult} difficiles
                    </Chip>
                  )}
                  {dueTriage.normal > 0 && (
                    <Chip color="var(--mastery-2)">
                      <Swatch color="var(--mastery-2)" size={7} />
                      {dueTriage.normal} normales
                    </Chip>
                  )}
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

        <StaggerItem>
          <div className="grid gap-3 sm:grid-cols-3">
            <Link to="/calendrier?plan=week" className="surface-card p-5 hover:bg-[var(--surface-hover)]">
              <Icon name="calendar" size={22} className="text-[var(--accent)]" />
              <h2 className="mt-3 text-base font-semibold">Organiser ma semaine</h2>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">Placer mes séances autour de mes horaires.</p>
            </Link>
            <Link to="/progression" className="surface-card p-5 hover:bg-[var(--surface-hover)]">
              <Icon name="review" size={22} className="text-[var(--accent)]" />
              <h2 className="mt-3 text-base font-semibold">Mes points de vigilance</h2>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">Voir mes résultats et les notions à consolider.</p>
            </Link>
            <Link to="/calendrier" className="surface-card p-5 hover:bg-[var(--surface-hover)]">
              <Icon name="quiz" size={22} className="text-[var(--accent)]" />
              <h2 className="mt-3 text-base font-semibold">{nextExam ? nextExam.event.title : 'Mon prochain examen'}</h2>
              <p className="mt-2 text-sm text-[var(--ink-soft)]">{nextExam ? eventTimingLabel(daysBetweenDayKeys(dayKey(), nextExam.event.day)) : 'Ajouter une échéance pour préparer mes révisions.'}</p>
            </Link>
          </div>
        </StaggerItem>
        <StaggerItem>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Quand travailler cette semaine ?</h2>
              <Link to="/calendrier?plan=week" className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)]">Préparer mon planning</Link>
            </div>
            {data.studyWindows ? (
              <>
                <p className="mt-1 text-sm text-[var(--ink-soft)]">Temps libre dans tes plages déclarées, après tes événements et cours récurrents. Aujourd’hui, seules les heures restantes comptent.</p>
                <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {data.studyWindows.map((slot) => (
                    <li key={slot.day} className={cn('rounded-xl border p-3', slot.minutes > 0 && slot.minutes === Math.max(...data.studyWindows!.map((day) => day.minutes)) ? 'border-[var(--accent)] bg-[var(--accent-tint)]' : 'border-[var(--line)]')}>
                      <p className="text-sm text-[var(--ink-soft)]">{new Date(`${slot.day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })}</p>
                      <p className="mt-2 text-base font-semibold">{Math.floor(slot.minutes / 60)} h {String(slot.minutes % 60).padStart(2, '0')}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-[var(--ink-soft)]">Les jours encadrés offrent le plus de temps. Ce sont des disponibilités, pas un objectif de travail continu.</p>
              </>
            ) : (
              <p className="mt-2 text-base text-[var(--ink-soft)]">Renseigne tes disponibilités dans le calendrier pour identifier les jours où tu peux le plus étudier. Aucun horaire n’est supposé à ta place.</p>
            )}
          </Card>
        </StaggerItem>

        <div className="grid gap-5 md:grid-cols-2">{secondaryCards}</div>

        {/* Résumé de la journée. */}
        <StaggerItem>
          <Card>
            <p className="text-[0.95rem] font-semibold">Aujourd’hui</p>
            {/*
              LE GRAND CHIFFRE EST CELUI DE L'OBJECTIF, juste en dessous.

              Il annonçait le temps — « 0 min étudiées » — au-dessus de
              « 3 cartes révisées » et d'un objectif compté EN CARTES. Trois
              unités, deux chiffres qui se contredisent, et c'est celui qui dit
              zéro qu'on croit. Les cartes passent en tête : c'est ce que
              l'objectif mesure, et ce qu'on vient réellement de faire.
            */}
            <p className="mt-2 text-[1.6rem] font-semibold leading-none tabular-nums">
              <CountUp value={dailySummary.cardsReviewed} />{' '}
              {agree(dailySummary.cardsReviewed, 'carte')} {agree(dailySummary.cardsReviewed, 'révisée')}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[0.82rem] text-[var(--ink-soft)]">
              {/* Le temps reste dit, mais jamais « 0 min » quand du travail a
                  eu lieu : `formatDuration` écrit « moins d'1 min ». */}
              <span data-home-time>
                {dailySummary.msStudied > 0 ? `${formatDuration(dailySummary.msStudied)} étudiées` : 'pas encore de temps mesuré'}
              </span>
              <span>{plural(dailySummary.documentsOpened, 'cours', 'cours')} {agree(dailySummary.documentsOpened, 'ouvert')}</span>
            </div>
            <div className="mt-4 flex items-center justify-between text-[0.78rem] text-[var(--ink-faint)]">
              <span>Objectif du jour</span>
              <span>
                {dailySummary.cardsReviewed}/{dailyCardGoal} cartes
              </span>
            </div>
            <div className="mt-1.5">
              <ProgressBar value={dailySummary.cardsReviewed} max={dailyCardGoal} label="Objectif quotidien de révision" color="var(--success)" />
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
