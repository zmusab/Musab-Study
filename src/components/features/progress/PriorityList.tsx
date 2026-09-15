import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '@/components/ui';
import { BandDot } from './ProgressBits';
import { useCascade } from '@/components/motion/Reveal';
import { URGENCY_HORIZON_DAYS, type PriorityItem } from '@/core/progress/exam';

/**
 * « À travailler en priorité ».
 *
 * Chaque ligne dit POURQUOI elle est là — échéance réelle, maîtrise mesurée,
 * taux d'erreur, ancienneté — parce qu'un classement dont on ne comprend pas
 * la logique ne se suit pas. Les raisons sont construites à partir des seules
 * valeurs mesurées : un chapitre jamais révisé est annoncé comme tel, il ne
 * reçoit pas un faux 0 %.
 */
export function PriorityList({ items, limit = 3 }: { items: PriorityItem[]; limit?: number }) {
  // Deux cascades distinctes, jamais confondues : celle du DÉFILEMENT (la
  // liste entre à l'écran) et celle du DÉPLIAGE (« Voir tout »). Une ligne
  // déjà visible ne rejoue pas son entrée quand on déplie la suite.
  const [listRef, cascadeProps] = useCascade<HTMLUListElement>();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, limit);
  const hidden = items.length - shown.length;

  return (
    <>
      <ul ref={listRef} className="flex flex-col gap-2" data-progress-priorities>
      {shown.map((item, index) => {
        const urgent = item.evaluation !== null && item.evaluation.daysUntil <= URGENCY_HORIZON_DAYS;
        return (
          <li
            key={item.id}
            {...(index >= limit
              ? { className: 'reveal', style: { '--reveal-index': index - limit } as CSSProperties }
              : cascadeProps(index))}
          >
            <Card className="flex flex-wrap items-center gap-3">
              <span
                aria-hidden
                className="h-9 w-1 shrink-0 rounded-full"
                style={{
                  backgroundColor:
                    item.masteryPct === null
                      ? 'var(--line-strong)'
                      : item.masteryPct < 50
                        ? 'var(--danger)'
                        : item.masteryPct < 70
                          ? 'var(--warning)'
                          : 'var(--accent)',
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.95rem] font-medium">
                  {item.chapterId === null ? item.subjectName : `${item.subjectName} — ${item.chapterName}`}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.82rem]">
                  {item.reasons.map((reason, index) => (
                    <span
                      key={reason}
                      className={
                        index === 0 && urgent ? 'font-medium text-[var(--danger)]' : 'text-[var(--ink-soft)]'
                      }
                    >
                      {index > 0 && <span className="mr-2 text-[var(--ink-faint)]">·</span>}
                      {reason}
                    </span>
                  ))}
                  {item.reasons.length === 0 && (
                    <span className="text-[var(--ink-soft)]">{item.cards} cartes à consolider</span>
                  )}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-[0.85rem] tabular-nums text-[var(--ink-soft)]">
                <BandDot pct={item.masteryPct} />
                {item.masteryPct === null ? '—' : `${item.masteryPct} %`}
              </span>
              {item.cardIds.length > 0 && (
                <Link to={`/revisions?cards=${item.cardIds.join(',')}`} className="shrink-0">
                  <Button size="sm" variant="secondary">
                    Réviser
                  </Button>
                </Link>
              )}
            </Card>
          </li>
        );
      })}
      </ul>
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          data-progress-priorities-more
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-2 rounded-full border border-[var(--line)] px-3 py-1.5 text-[0.8rem] font-medium text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        >
          {expanded ? 'Voir moins' : `Voir tout — ${hidden} de plus`}
        </button>
      )}
    </>
  );
}
