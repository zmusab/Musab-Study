import { useLiveQuery } from 'dexie-react-hooks';
import { getDocumentFile } from '@/data/repositories/documents';
import { formatBytes } from '@/lib/format';
import type { ID } from '@/types';

/** Taille du PDF original — lue depuis `documentFiles`, jamais stockée en double. */
export function DocumentFileSize({ documentId }: { documentId: ID }) {
  const file = useLiveQuery(() => getDocumentFile(documentId), [documentId]);
  if (!file) return null;
  return <span>{formatBytes(file.blob.size)}</span>;
}
