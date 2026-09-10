import { getProfile, saveProfile } from '@/data/repositories/profile';
import { reindexAllDocuments } from '@/data/repositories/documents';

/**
 * REMISE À NIVEAU AUTOMATIQUE DES COURS DÉJÀ IMPORTÉS.
 *
 * L'extraction des PDF a été corrigée après coup (`courseLayout.ts` : puces
 * rendues, accents recollés, en-têtes courants retirés). Le correctif ne vaut
 * que pour les documents importés APRÈS lui — ceux qui étaient déjà en base
 * gardent leur texte aplati, et l'assistant continue de répondre « absent de
 * tes cours » sur un sujet pourtant traité.
 *
 * Un bouton « Retraiter tous mes documents » existait dans les Paramètres.
 * C'était une mauvaise réponse : il faut le trouver, comprendre à quoi il
 * sert, et savoir qu'on en a besoin. Un utilisateur qui constate simplement
 * que « l'IA n'arrive toujours pas à répondre » n'a aucune raison d'aller le
 * chercher — et c'est exactement ce qui s'est produit.
 *
 * La remise à niveau se fait donc SEULE, une fois, au démarrage.
 *
 * Trois précautions :
 *  - elle est idempotente et marquée : `courseLayoutVersion` enregistre la
 *    version réellement appliquée, donc le travail n'est jamais refait ;
 *  - elle ne bloque rien : l'appel n'est pas attendu, l'interface s'affiche
 *    normalement pendant ce temps ;
 *  - elle ne peut pas casser le démarrage : toute erreur est absorbée, la
 *    version n'est alors pas avancée et un prochain lancement réessaiera.
 *
 * Elle ne touche ni aux flashcards, ni à l'historique de révision : seuls le
 * texte du document et ses fragments d'index sont reconstruits.
 */

/**
 * Version courante du traitement. À INCRÉMENTER à chaque correction de
 * `courseLayout.ts` qui change le texte produit — c'est ce qui déclenchera la
 * remise à niveau chez les utilisateurs existants.
 *
 * 1 — puces, accents détachés, en-têtes courants, sections.
 * 2 — en-tête retiré aussi sur les pages à deux chiffres, numéros de page
 *     isolés écartés.
 */
export const COURSE_LAYOUT_VERSION = 2;

export interface ReindexOutcome {
  /** `true` si un retraitement a réellement eu lieu. */
  ran: boolean;
  changed: number;
  total: number;
}

/**
 * Exécution en cours, partagée par tous les appelants.
 *
 * `useEffect` est invoqué DEUX FOIS en mode strict, et rien n'empêche un
 * autre écran de demander la même remise à niveau. Sans ce garde-fou, deux
 * passages lisent la version 0 en même temps et retraitent la bibliothèque
 * en double : le résultat serait identique — l'opération est idempotente —
 * mais le travail serait fait deux fois sur un appareil qui n'en a pas les
 * moyens à revendre. Le second appel attend le premier et reçoit son
 * résultat.
 */
let inFlight: Promise<ReindexOutcome> | null = null;

export function runPendingReindex(): Promise<ReindexOutcome> {
  inFlight ??= reindexOnce().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function reindexOnce(): Promise<ReindexOutcome> {
  const idle: ReindexOutcome = { ran: false, changed: 0, total: 0 };
  try {
    const profile = await getProfile();
    if ((profile.courseLayoutVersion ?? 0) >= COURSE_LAYOUT_VERSION) return idle;

    const { changed, total } = await reindexAllDocuments();
    await saveProfile({ courseLayoutVersion: COURSE_LAYOUT_VERSION });
    return { ran: true, changed, total };
  } catch {
    // La version n'est pas avancée : le prochain démarrage réessaiera. Une
    // bibliothèque non remise à niveau reste utilisable — c'est l'état
    // d'avant le correctif, pas une base cassée.
    return idle;
  }
}
