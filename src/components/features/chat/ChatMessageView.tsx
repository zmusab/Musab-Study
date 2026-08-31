import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Chip } from '@/components/ui';
import { springSoft } from '@/components/motion/transitions';
import { cn } from '@/lib/cn';
import type { ChatMessage } from '@/types';

/**
 * Affichage d'un message.
 *
 * La provenance n'est pas un simple ornement : elle est calculée par la
 * vérification des citations, jamais déclarée par le modèle. Un badge 📚
 * garantit donc qu'au moins un passage réel des cours soutient la réponse.
 */

const PROVENANCE_BADGE = {
  course: { label: 'Trouvé dans tes cours', icon: '📚', color: 'var(--success)' },
  internet: { label: 'Complété par internet', icon: '🌐', color: 'var(--accent)' },
  insufficient: { label: 'Absent de tes cours', icon: '⚠️', color: 'var(--warning)' },
  error: { label: 'Erreur', icon: '✕', color: 'var(--danger)' },
} as const;

export function ChatMessageView({ message }: { message: ChatMessage }) {
  const reduced = useReducedMotion();
  const [showSources, setShowSources] = useState(false);

  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-[var(--accent-tint)] px-4 py-3 text-[0.92rem] leading-relaxed text-[var(--ink)]">
        {message.text}
      </div>
    );
  }

  const badge = message.provenance ? PROVENANCE_BADGE[message.provenance] : null;

  return (
    <div className="max-w-[94%]">
      {badge && (
        <div className="mb-2">
          <Chip color={badge.color}>
            <span aria-hidden>{badge.icon}</span>
            {badge.label}
          </Chip>
        </div>
      )}

      <div
        className={cn(
          'surface-card whitespace-pre-wrap px-4 py-3 text-[0.92rem] leading-relaxed',
          message.provenance === 'insufficient' &&
            'border-[var(--warning)] bg-[var(--warning-tint)]',
          message.provenance === 'error' && 'border-[var(--danger)] bg-[var(--danger-tint)]',
        )}
      >
        {message.text}
      </div>

      {message.citations.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowSources((current) => !current)}
            className="text-[0.78rem] font-semibold text-[var(--ink-soft)] underline underline-offset-2 transition-colors hover:text-[var(--ink)]"
          >
            {showSources ? 'Masquer' : 'Voir'} les {message.citations.length} source(s)
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
                    <p className="font-mono text-[0.72rem] text-[var(--ink-faint)]">
                      {citation.subjectName} › {citation.chapterName} › {citation.documentName}
                    </p>
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
    </div>
  );
}
