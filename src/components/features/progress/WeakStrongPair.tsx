import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';
import { EmptyHint } from './ProgressBits';
import { masteryBand } from '@/core/progress';
import type { StrengthItem } from '@/core/progress/exam';
import type { WeakPoint } from '@/core/progress';

/**
 * POINTS FAIBLES et POINTS FORTS, côte à côte et compacts.
 *
 * Deux listes courtes plutôt que deux grandes cartes : l'information tient en
 * une ligne par élément — un nom, une valeur mesurée, une couleur. Le reste
 * (nombre de réponses, matière) est en gris, au second plan.
 *
 * Les points forts n'ont pas de bouton : il n'y a rien à corriger. Les points
 * faibles en ont un, parce qu'il y a une action évidente à proposer.
 */
export function WeakStrongPair({ weak, strengths }: { weak: WeakPoint[]; strengths: StrengthItem[] }) {
  return (
    <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
      <Card>
        <h3 className="text-[0.95rem] font-semibold leading-tight">Tes points faibles</h3>
        <p className="mt-0.5 text-[0.78rem] text-[var(--ink-faint)]">
          Sous 75 % de réussite, sur au moins 3 réponses.
        </p>
        {weak.length === 0 ? (
          <div className="mt-3">
            <EmptyHint title="Rien de fragile pour l’instant.">
              Un chapitre entre ici quand tes réponses y descendent réellement sous 75 %.
            </EmptyHint>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col" data-progress-weak>
            {weak.slice(0, 4).map((point) => (
              <li key={point.id}>
                <Link
                  to={`/revisions?cards=${point.cardIds.join(',')}`}
                  className="flex min-h-[2.6rem] items-center gap-2.5 rounded-[var(--radius-control)] px-2 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: point.successRate < 0.5 ? 'var(--mastery-0)' : 'var(--mastery-1)' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.88rem] font-medium" title={point.title}>
                      {point.title}
                    </span>
                    <span className="block truncate text-[0.76rem] text-[var(--ink-faint)]">
                      {point.subjectName || 'Sans matière'} · {point.reviews} réponse
                      {point.reviews > 1 ? 's' : ''}
                    </span>
                  </span>
                  {/* La valeur est nommée : « 20 % » seul se confondrait avec
                      la maîtrise affichée dans la colonne d'à côté. */}
                  <span className="shrink-0 text-right">
                    <span
                      className="block text-[0.85rem] font-semibold leading-tight tabular-nums"
                      style={{ color: point.successRate < 0.5 ? 'var(--mastery-0)' : 'var(--mastery-1)' }}
                    >
                      {Math.round(point.successRate * 100)} %
                    </span>
                    <span className="block text-[0.66rem] leading-tight text-[var(--ink-faint)]">réussite</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="text-[0.95rem] font-semibold leading-tight">Tes points forts</h3>
        <p className="mt-0.5 text-[0.78rem] text-[var(--ink-faint)]">Maîtrise mesurée au-dessus de 80 %.</p>
        {strengths.length === 0 ? (
          <div className="mt-3">
            <EmptyHint title="Aucun chapitre n’atteint encore ce niveau.">
              Un chapitre entre ici quand la répétition espacée a réellement espacé ses cartes dans le temps.
            </EmptyHint>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col" data-progress-strengths>
            {strengths.slice(0, 4).map((item) => (
              <li
                key={item.id}
                className="flex min-h-[2.6rem] items-center gap-2.5 px-2 py-1.5"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: masteryBand(item.masteryPct).colorVar }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.88rem] font-medium">{item.chapterName}</span>
                  <span className="block truncate text-[0.76rem] text-[var(--ink-faint)]">
                    {item.subjectName}
                    {item.reviews > 0 && ` · ${item.reviews} réponse${item.reviews > 1 ? 's' : ''}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className="block text-[0.85rem] font-semibold leading-tight tabular-nums"
                    style={{ color: masteryBand(item.masteryPct).colorVar }}
                  >
                    {item.masteryPct} %
                  </span>
                  <span className="block text-[0.66rem] leading-tight text-[var(--ink-faint)]">maîtrise</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
