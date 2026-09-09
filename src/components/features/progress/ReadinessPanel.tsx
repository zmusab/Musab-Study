import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Icon } from '@/components/ui';
import { MasteryBar } from './ProgressBits';
import type { ExamReadiness } from '@/core/progress/exam';
import type { Evaluation } from '@/core/progress/exam';
import type { ChapterProgress } from '@/core/progress';

/**
 * SUFFISANCE EXAMEN — bloc de préparation d'une matière.
 *
 * Trois précautions de fond :
 *  - le chiffre n'apparaît que s'il est mesurable ; sinon la carte dit ce
 *    qu'il manque, sans afficher 0 % ;
 *  - le libellé parle de préparation ESTIMÉE, jamais de réussite promise ;
 *  - le détail du calcul est consultable, pour que la note reste auditable
 *    plutôt que d'être un score sorti d'une boîte noire.
 *
 * Le bloc fonctionne à l'identique avec ou sans date d'examen : quand une
 * évaluation est réellement inscrite au calendrier, elle est rappelée en
 * en-tête ; sinon rien n'est inventé et la suffisance suffit à se situer.
 */
export function ReadinessPanel({
  subjectName,
  readiness,
  evaluation,
  chapters,
  reviseHref,
  chapterCardIds,
}: {
  subjectName: string;
  readiness: ExamReadiness;
  evaluation: Evaluation | null;
  /** Chapitres de la matière, pour montrer ce qui doit être renforcé. */
  chapters: ChapterProgress[];
  reviseHref: string | null;
  /** Cartes de chaque chapitre — un lien n'est proposé que s'il mène quelque part. */
  chapterCardIds: Map<string, string[]>;
}) {
  const [detailOpen, setDetailOpen] = useState(false);

  const toReinforce = chapters
    .filter((chapter) => chapter.masteryPct === null || chapter.masteryPct < 70)
    .slice(0, 5);

  return (
    <Card data-progress-readiness>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[0.8rem] font-medium uppercase tracking-wide text-[var(--ink-faint)]">
            <Icon name="quiz" size={14} /> Suffisance examen
          </p>
          <p className="mt-1 text-[1.15rem] font-semibold leading-snug">{subjectName}</p>
        </div>
        {evaluation && (
          <div className="shrink-0 rounded-full border border-[var(--line)] px-3 py-1 text-[0.8rem] text-[var(--ink-soft)]">
            {evaluation.label}{' '}
            <span className="font-medium text-[var(--ink)]">
              {evaluation.daysUntil === 0
                ? 'aujourd’hui'
                : evaluation.daysUntil === 1
                  ? 'demain'
                  : `dans ${evaluation.daysUntil} jours`}
            </span>
          </div>
        )}
      </div>

      {readiness.pct === null ? (
        <div className="note-block mt-4 p-4">
          <p className="text-[0.9rem] font-medium text-[var(--ink-soft)]">Données insuffisantes</p>
          <p className="mt-1 text-[0.83rem] leading-relaxed text-[var(--ink-faint)]">
            {readiness.missingReason} La suffisance examen croise ta couverture du programme, ta maîtrise, ta
            fiabilité et la fraîcheur de tes révisions : elle a besoin de vraies réponses pour signifier quelque
            chose.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span
              data-progress-readiness-pct
              className="text-[2.6rem] font-semibold leading-none tabular-nums"
              style={{ color: readiness.level!.colorVar }}
            >
              {readiness.pct} %
            </span>
            <span className="text-[0.95rem] font-medium" style={{ color: readiness.level!.colorVar }}>
              {readiness.level!.label}
            </span>
          </div>
          <div className="mt-3">
            <ReadinessBar pct={readiness.pct} color={readiness.level!.colorVar} />
          </div>
          <p className="mt-2 text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
            Niveau de préparation estimé à partir de tes révisions — ce n’est pas un pronostic de résultat.
          </p>

          {toReinforce.length > 0 && (
            <div className="mt-4">
              <p className="text-[0.85rem] font-medium">Ce qui doit encore être renforcé</p>
              <ul className="mt-2 flex flex-col gap-1.5" data-progress-reinforce>
                {toReinforce.map((chapter) => {
                  const key = chapter.chapterId ?? 'orphan';
                  const ids = chapterCardIds.get(key) ?? [];
                  const row = (
                    <>
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            chapter.masteryPct === null
                              ? 'var(--line-strong)'
                              : chapter.masteryPct < 50
                                ? 'var(--danger)'
                                : 'var(--warning)',
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[0.87rem]">{chapter.name}</span>
                      <span className="shrink-0 text-[0.82rem] tabular-nums text-[var(--ink-faint)]">
                        {chapter.masteryPct === null ? 'jamais révisé' : `${chapter.masteryPct} %`}
                      </span>
                    </>
                  );
                  // Pas de lien sans destination réelle : un élément qui a
                  // l'air cliquable et ne mène nulle part est pire qu'un
                  // élément inerte assumé.
                  return (
                    <li key={key}>
                      {ids.length > 0 ? (
                        <Link
                          to={`/revisions?cards=${ids.join(',')}`}
                          className="flex min-h-[2.4rem] items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
                        >
                          {row}
                        </Link>
                      ) : (
                        <div className="flex min-h-[2.4rem] items-center gap-2.5 px-2 py-1.5">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {reviseHref && (
              <Link to={reviseHref}>
                <Button size="sm">Réviser maintenant</Button>
              </Link>
            )}
            <Button size="sm" variant="ghost" onClick={() => setDetailOpen((open) => !open)}>
              {detailOpen ? 'Masquer le détail du calcul' : 'Voir le détail du calcul'}
            </Button>
          </div>

          {detailOpen && (
            <ul className="mt-3 flex flex-col gap-2.5 border-t border-[var(--line)] pt-3" data-progress-readiness-detail>
              {readiness.components.map((component) => (
                <li key={component.key} className="reveal">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.85rem]">
                      {component.label}
                      <span className="ml-1.5 text-[0.75rem] text-[var(--ink-faint)]">
                        ·{' '}
                        {component.role === 'base'
                          ? `${Math.round(component.weight * 100)} % de la note de base`
                          : `modulateur, jusqu’à −${Math.round((1 - component.weight) * 100)} %`}
                      </span>
                    </span>
                    <span className="shrink-0 text-[0.85rem] tabular-nums text-[var(--ink-soft)]">
                      {component.pct} %
                    </span>
                  </div>
                  <div className="mt-1.5">
                    <MasteryBar pct={component.pct} height={4} />
                  </div>
                  <p className="mt-1 text-[0.75rem] text-[var(--ink-faint)]">{component.detail}</p>
                </li>
              ))}
              <li className="text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
                Les deux premiers signaux forment la note de départ ; les deux suivants ne peuvent que la faire
                baisser — avoir ouvert son cours n’est pas un acquis, ne pas l’avoir ouvert est un handicap.
              </li>
              {readiness.weakest && (
                <li className="text-[0.78rem] leading-relaxed text-[var(--ink-faint)]">
                  La note est ensuite tirée vers ton maillon le plus faible —{' '}
                  <span className="text-[var(--ink-soft)]">{readiness.weakest.name}</span>, à{' '}
                  {readiness.weakest.pct} % — qui compte pour un quart du résultat.
                </li>
              )}
              <li className="text-[0.75rem] leading-relaxed text-[var(--ink-faint)]">
                Les résultats de quiz n’entrent pas encore dans ce calcul : la fonctionnalité Quiz n’existe pas et
                n’enregistre donc aucune réponse.
              </li>
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

/** Barre de suffisance — teinte imposée par le niveau, pas par la valeur brute. */
function ReadinessBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, backgroundColor: color, transition: 'width 800ms cubic-bezier(0.22,0.61,0.36,1)' }}
      />
    </div>
  );
}
