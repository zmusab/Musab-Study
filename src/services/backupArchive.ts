import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { db } from '@/data/db';
import { exportBackup, importBackup, type ImportReport } from '@/services/backup';
import type { BackupBundle } from '@/types';

/**
 * SAUVEGARDE COMPLÈTE — les PDF originaux compris.
 *
 * La sauvegarde JSON n'emporte que du texte : les PDF d'origine restent sur
 * l'appareil. C'était une limite assumée et annoncée, mais elle a une
 * conséquence brutale — en changeant d'appareil, on récupère ses cours, ses
 * cartes et son historique, et on doit ré-importer chaque PDF à la main.
 *
 * Un JSON ne peut pas porter un binaire sans le gonfler d'un tiers en base64,
 * et une bibliothèque de cinquante mégaoctets deviendrait une chaîne de
 * soixante-sept mégaoctets à construire d'un seul tenant — ce qu'un iPad ne
 * pardonne pas. L'archive ZIP garde donc le binaire binaire :
 *
 *     data.json          la sauvegarde habituelle, à l'octet près
 *     fichiers/<id>.pdf  le PDF d'origine de chaque document qui en a un
 *
 * Deux décisions à retenir :
 *
 *  - `data.json` est EXACTEMENT ce que produit `exportBackup()`. L'archive
 *    n'est pas un second format : c'est le même, dans une enveloppe. Un
 *    utilisateur peut ouvrir le ZIP et récupérer son JSON.
 *  - Les PDF sont stockés SANS COMPRESSION (`level: 0`). Un PDF est déjà
 *    compressé : le recomprimer coûte des secondes de calcul sur un appareil
 *    mobile pour gagner quelques pour cent. Seul `data.json`, du texte, est
 *    réellement compressé.
 */

/** Nom du dossier des fichiers dans l'archive — en clair, pour qu'il se lise. */
const FILES_DIR = 'fichiers';
const DATA_ENTRY = 'data.json';

/** Un fichier joint, réduit à ce que l'archive manipule : un identifiant et des octets. */
export interface ArchivedFile {
  documentId: string;
  bytes: Uint8Array;
}

/**
 * EMBALLAGE — fonction pure, sans base de données.
 *
 * La séparation n'est pas cosmétique : `fake-indexeddb` ne restitue pas les
 * Blob qu'on lui confie (ils reviennent en objets vides), si bien qu'un
 * aller-retour passant par Dexie ne peut RIEN prouver sur les octets en test.
 * En isolant l'emballage, la garantie qui compte — l'octet ressort identique —
 * devient vérifiable ici, et le reste (lecture/écriture en base) se vérifie
 * dans un vrai navigateur.
 */
export function packArchive(bundle: BackupBundle, files: readonly ArchivedFile[]): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    [DATA_ENTRY]: [strToU8(JSON.stringify(bundle)), { level: 6 }],
  };
  for (const file of files) {
    entries[`${FILES_DIR}/${file.documentId}.pdf`] = [file.bytes, { level: 0 }];
  }
  return zipSync(entries);
}

/**
 * DÉBALLAGE — fonction pure. Lève si `data.json` manque ou si le contenu n'a
 * pas la forme d'une sauvegarde : mieux vaut refuser que d'effacer la
 * bibliothèque au profit de quelque chose d'illisible.
 */
export function unpackArchive(zipped: Uint8Array): { bundle: BackupBundle; files: ArchivedFile[] } {
  const entries = unzipSync(zipped);

  const data = entries[DATA_ENTRY];
  if (!data) throw new Error('Archive incomplète : data.json est absent.');

  const bundle = JSON.parse(strFromU8(data)) as BackupBundle;
  if (!Array.isArray(bundle.subjects)) throw new Error('Format non reconnu.');

  const files: ArchivedFile[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith(`${FILES_DIR}/`) || !path.endsWith('.pdf')) continue;
    files.push({ documentId: path.slice(FILES_DIR.length + 1, -'.pdf'.length), bytes });
  }
  return { bundle, files };
}

export interface ArchiveExport {
  blob: Blob;
  /** Nombre de PDF réellement joints — jamais supposé, toujours compté. */
  files: number;
  /**
   * Fichiers présents en base mais impossibles à lire. Comptés et annoncés :
   * une sauvegarde incomplète qui se présente comme complète est pire que pas
   * de sauvegarde du tout.
   */
  skipped: number;
  bytes: number;
}

/**
 * Octets d'un fichier stocké, ou `null` s'il est illisible.
 *
 * Un `documentFiles` corrompu ou vidé par le navigateur ferait autrement
 * échouer l'export ENTIER : l'utilisateur perdrait la possibilité de
 * sauvegarder ses cours à cause d'un seul PDF abîmé. On saute la ligne, on la
 * compte, et on le dit.
 */
async function readableBytes(blob: Blob): Promise<Uint8Array | null> {
  try {
    if (typeof blob?.arrayBuffer !== 'function') return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

export async function exportBackupArchive(): Promise<ArchiveExport> {
  const bundle = await exportBackup();
  const files = await db.documentFiles.toArray();

  const joinable: ArchivedFile[] = [];
  let skipped = 0;
  for (const file of files) {
    const bytes = await readableBytes(file.blob);
    if (bytes === null) {
      skipped += 1;
      continue;
    }
    joinable.push({ documentId: file.documentId, bytes });
  }

  const zipped = packArchive(bundle, joinable);
  // `slice()` détache la vue de son tampon : sans lui, le Blob peut recevoir
  // tout le tampon sous-jacent au lieu de la seule portion utile.
  const blob = new Blob([zipped.slice()], { type: 'application/zip' });
  return { blob, files: joinable.length, skipped, bytes: blob.size };
}

export interface ArchiveImportReport extends ImportReport {
  /** PDF restaurés. Zéro est une réponse valable : l'archive n'en contenait pas. */
  files: number;
}

/**
 * Restaure une archive complète.
 *
 * L'ordre compte : `importBackup` commence par TOUT effacer, y compris la
 * table des fichiers. Les PDF sont donc réécrits après lui, jamais avant.
 *
 * Un fichier dont le document n'existe pas dans la sauvegarde est ignoré :
 * une ligne orpheline dans `documentFiles` ne serait rattachée à rien et
 * occuperait de la place sans qu'aucun écran ne puisse l'ouvrir.
 */
export async function importBackupArchive(file: Blob): Promise<ArchiveImportReport> {
  // Le déballage vient AVANT toute écriture : une archive illisible ne doit
  // pas avoir effacé la bibliothèque en cours de route.
  const { bundle, files } = unpackArchive(new Uint8Array(await file.arrayBuffer()));

  const report = await importBackup(bundle);

  const knownDocuments = new Set(bundle.documents.map((doc) => doc.id));
  let restored = 0;
  for (const archived of files) {
    if (!knownDocuments.has(archived.documentId)) continue;
    await db.documentFiles.put({
      documentId: archived.documentId,
      blob: new Blob([archived.bytes.slice()], { type: 'application/pdf' }),
    });
    restored += 1;
  }

  return { ...report, files: restored };
}

/**
 * Une archive ZIP commence par « PK\x03\x04 ». On lit les quatre premiers
 * octets plutôt que de se fier à l'extension : un fichier renommé, ou
 * téléchargé sous un autre nom, doit être reconnu pour ce qu'il est.
 */
export async function looksLikeArchive(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}
