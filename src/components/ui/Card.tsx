import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
}

export function Card({ children, className, padded = true, ...rest }: CardProps) {
  return (
    <div className={cn('surface-card', padded && 'p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-[1.1rem] mb-1', className)}>{children}</h2>;
}

export function CardSubtitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[0.87rem] leading-relaxed text-[var(--ink-soft)]', className)}>
      {children}
    </p>
  );
}
