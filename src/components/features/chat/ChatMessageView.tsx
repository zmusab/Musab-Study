import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Chip, Icon } from '@/components/ui';
import type { IconName } from '@/components/ui/Icon';
import { AnswerText } from './AnswerText';
import { springSoft } from '@/components/motion/transitions';
import { cn } from '@/lib/cn';
import type { AnswerProvenance, ChatMessage } from '@/types';

/**
 * Affichage d'un message.
 *
 * La provenance n'est pas un simple ornement : elle est calculée par la
 * vérification des citations, jamais déclarée par le modèle. Le badge
 * « Trouvé dans tes cours » garantit donc qu'au moins un passage réel des
 * cours soutient la réponse.
 *
 * Les cinq pictogrammes étaient des emoji (📚 ⚙️ 🌐 ⚠️ ✕) : cinq styles de
 * dessin différents, aucun n'appartenant à la famille graphique du reste de
 * l'interface, et rendus différemment sur chaque plateforme.
 */

const PROVENANCE_BADGE: Record<AnswerProvenance, { label: string; icon: IconName; color: string }> = {
  course: { label: 'Trouvé dans tes cours', icon: 'courses', color: 'var(--success)' },
  'course-local': { label: 'Tes cours', icon: 'courses', color: 'var(--success)' },
  internet: { label: 'Complété par internet', icon: 'search', color: 'var(--accent)' },
  insufficient: { label: 'À préciser', icon: 'quiz', color: 'var(--warning)' },
  error: { label: 'Erreur', icon: 'close', color: 'var(--danger)' },
};

const PROVIDER_LABEL: Record<'anthropic' | 'openai' | 'gemini', string> = {
  anthropic: 'Claude',
  openai: 'ChatGPT',
  gemini: 'Gemini',
};

/** Le badge nomme le fournisseur réel quand on le connaît — jamais un « IA » générique s'il est évitable. */
function badgeLabel(message: ChatMessage): string {
  const base = message.provenance ? PROVENANCE_BADGE[message.provenance].label : '';
  if ((message.provenance === 'course' || message.provenance === 'internet') && message.providerId) {
    return `Généré avec ${PROVIDER_LABEL[message.providerId]} — ${base.toLowerCase()}`;
  }
  return base;
}

export interface AnswerAction {
  label: string;
  onClick: () => void;
}

export function ChatMessageView({ message, actions }: { message: ChatMessage; actions?: AnswerAction[] }) {
  const reduced = useReducedMotion();
  const [showSources, setShowSources] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');

  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[var(--accent-tint)] px-4 py-3 text-[0.92rem] leading-relaxed text-[var(--ink)]">
        {message.text}
      </div>
    );
  }

  const badge = message.provenance ? PROVENANCE_BADGE[message.provenance] : null;

  return (
    <motion.div className="max-w-[94%]" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      {badge && (
        <div className="mb-2">
          <Chip color={badge.color}>
            <Icon name={badge.icon} size={13} aria-hidden />
            {badgeLabel(message)}
          </Chip>
        </div>
      )}

      <div
        className={cn(
          'surface-card px-4 py-3',
          message.provenance === 'insufficient' &&
            'border-[var(--warning)] bg-[var(--warning-tint)]',
          message.provenance === 'error' && 'border-[var(--danger)] bg-[var(--danger-tint)]',
        )}
      >
        <AnswerText text={message.text} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className="rounded-full border border-[var(--line)] px-3 py-2 text-xs transition-colors hover:bg-[var(--accent-tint)]" onClick={async () => {
          try { await navigator.clipboard.writeText(message.text); setCopyState('done'); }
          catch { setCopyState('error'); }
        }}>Copier la réponse</button>
        <span role="status" className="text-xs text-[var(--ink-soft)]">{copyState === 'done' ? 'Réponse copiée' : copyState === 'error' ? 'Copie indisponible. Sélectionne le texte pour le copier.' : ''}</span>
      </div>

      {/* Actions proposées seulement sous une VRAIE réponse — jamais sous une
          erreur ni sous un « absent de tes cours », où elles n'auraient rien
          à reprendre. */}
      {actions &&
        (message.provenance === 'course' ||
          message.provenance === 'course-local' ||
          message.provenance === 'internet') && (
        <div className="mt-2 flex flex-wrap gap-2" data-answer-actions>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              data-touch-target
              className="rounded-full border border-[var(--line)] px-3 py-1.5 text-[0.78rem] text-[var(--ink-soft)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--ink)] [-webkit-tap-highlight-color:transparent]"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {message.citations.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowSources((current) => !current)}
            className="text-[0.78rem] font-semibold text-[var(--ink-soft)] underline underline-offset-2 transition-colors hover:text-[var(--ink)]"
          >
            {showSources ? 'Masquer' : 'Voir'}{' '}
            {message.citations.length > 1
              ? `les ${message.citations.length} sources`
              : 'la source'}
          </button>

          <AnimatePresence initial={false}>
            {showSources && (
              <motion.ul
                initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={reduced ? { duration: 0 } : springSoft}
                className="mt-2 flex flex-col gap-2 overflow-hidden"
              >
                {message.citations.map((citation, index) => (
                  <li
                    key={`${citation.chunkId}-${index}`}
                    className="rounded-[var(--radius-control)] border-l-2 border-[var(--accent)] bg-[var(--surface-2)] px-3.5 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-mono text-[0.72rem] text-[var(--ink-faint)]">
                        {citation.subjectName} › {citation.chapterName} › {citation.documentName}
                      </p>
                      {citation.page !== null && (
                        <Link
                          to={`/document/${citation.documentId}?page=${citation.page}`}
                          className="shrink-0 rounded-full border border-[var(--accent)]/40 bg-[var(--accent-tint)] px-2.5 py-1 text-[0.72rem] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-tint)]/70"
                        >
                          📄 page {citation.page}
                        </Link>
                      )}
                    </div>
                    {/* L'extrait exact rend l'affirmation contrôlable : tu peux
                        vérifier la réponse sans rouvrir le PDF. */}
                    <p className="mt-1.5 text-[0.82rem] italic leading-relaxed text-[var(--ink-soft)]">
                      « {citation.excerpt} »
                    </p>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}
