import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * Champs de formulaire.
 *
 * Tous héritent des 16px définis dans la feuille de base : en dessous, Safari
 * iOS zoome à chaque focus et casse la mise en page sur iPad.
 */

const CONTROL_BASE = cn(
  'w-full bg-[var(--bg-elevated)] text-[var(--ink)]',
  'border border-[var(--line)] rounded-[var(--radius-control)]',
  'px-3.5 py-2.5 min-h-11',
  'placeholder:text-[var(--ink-faint)]',
  'transition-colors duration-150',
  'hover:border-[var(--line-strong)]',
  'focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25',
  'disabled:opacity-55',
);

export function Field({
  label,
  hint,
  children,
  htmlFor,
  className,
}: {
  label?: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-[0.78rem] font-semibold tracking-wide text-[var(--ink-soft)]"
        >
          {label}
        </label>
      )}
      {children}
      {hint && <p className="text-[0.78rem] text-[var(--ink-faint)]">{hint}</p>}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: ReactNode };

export function Input({ label, hint, className, id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const control = <input id={inputId} className={cn(CONTROL_BASE, className)} {...rest} />;
  if (!label && !hint) return control;
  return (
    <Field label={label} hint={hint} htmlFor={inputId}>
      {control}
    </Field>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: ReactNode;
};

export function Textarea({ label, hint, className, id, rows = 4, ...rest }: TextareaProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const control = (
    <textarea
      id={inputId}
      rows={rows}
      className={cn(CONTROL_BASE, 'resize-y leading-relaxed', className)}
      {...rest}
    />
  );
  if (!label && !hint) return control;
  return (
    <Field label={label} hint={hint} htmlFor={inputId}>
      {control}
    </Field>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  hint?: ReactNode;
  children: ReactNode;
};

export function Select({ label, hint, className, id, children, ...rest }: SelectProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const control = (
    <select
      id={inputId}
      className={cn(CONTROL_BASE, 'appearance-none pr-9 cursor-pointer', className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%238b9098' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 0.75rem center',
        backgroundSize: '1rem',
      }}
      {...rest}
    >
      {children}
    </select>
  );
  if (!label && !hint) return control;
  return (
    <Field label={label} hint={hint} htmlFor={inputId}>
      {control}
    </Field>
  );
}
