import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui';

/** Couverture d'un document — première page rendue à l'import, ou une icône par défaut. */
export function DocumentThumbnail({ blob, className }: { blob: Blob | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return undefined;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  if (!url) {
    return (
      <div
        className={`flex items-center justify-center rounded-[0.5rem] bg-[var(--surface-2)] text-[var(--ink-faint)] ${className ?? ''}`}
      >
        <Icon name="courses" size={20} />
      </div>
    );
  }

  return (
    <img
      src={url}
      alt=""
      className={`rounded-[0.5rem] border border-[var(--line)] object-cover object-top ${className ?? ''}`}
    />
  );
}
