import type { DayKey, ISODateTime } from '@/types';

export const DAY_MS = 86_400_000;

export function nowISO(): ISODateTime {
  return new Date().toISOString();
}

/**
 * Jour civil LOCAL au format "AAAA-MM-JJ".
 *
 * Volontairement local et non UTC : à Iași (UTC+2/+3), une révision faite à
 * 00h30 doit compter pour le jour où tu l'as réellement faite, pas pour la
 * veille. Le prototype découpait la chaîne ISO UTC et décalait donc les
 * statistiques quotidiennes en soirée.
 */
export function dayKey(date: Date = new Date()): DayKey {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dayKeyFromISO(iso: ISODateTime): DayKey {
  return dayKey(new Date(iso));
}

export function parseDayKey(key: DayKey): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year!, month! - 1, day!);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Nombre de jours civils entiers entre deux jours, signé. */
export function daysBetweenDayKeys(from: DayKey, to: DayKey): number {
  return Math.round((parseDayKey(to).getTime() - parseDayKey(from).getTime()) / DAY_MS);
}

/** Derniers `count` jours, du plus ancien au plus récent, aujourd'hui inclus. */
export function lastNDays(count: number, today: Date = new Date()): DayKey[] {
  const days: DayKey[] = [];
  for (let i = count - 1; i >= 0; i -= 1) days.push(dayKey(addDays(today, -i)));
  return days;
}

export function formatRelativePast(iso: ISODateTime | null, now: Date = new Date()): string {
  if (!iso) return 'jamais';
  const days = daysBetweenDayKeys(dayKeyFromISO(iso), dayKey(now));
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} jours`;
  const months = Math.round(days / 30);
  return months === 1 ? 'il y a 1 mois' : `il y a ${months} mois`;
}

export function formatRelativeFuture(iso: ISODateTime, now: Date = new Date()): string {
  const days = daysBetweenDayKeys(dayKey(now), dayKeyFromISO(iso));
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  if (days < 30) return `dans ${days} jours`;
  const months = Math.round(days / 30);
  return months === 1 ? 'dans 1 mois' : `dans ${months} mois`;
}

const LONG_DATE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

export const formatLongDate = (date: Date): string => LONG_DATE.format(date);
export const formatShortDate = (date: Date): string => SHORT_DATE.format(date);
