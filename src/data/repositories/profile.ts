import { db } from '@/data/db';
import type { Profile } from '@/types';

export const DEFAULT_PROFILE: Profile = {
  id: 'me',
  name: '',
  university: 'UMF Iași – Grigore T. Popa',
  section: 'Française',
  program: 'Dentisterie',
  goals: '',
  theme: 'system',
  dailyCardGoal: 30,
  // 5 h de révision et 150 réponses par semaine : un rythme de travail
  // régulier, modifiable depuis « Progression ». Ce sont des OBJECTIFS, pas
  // des mesures — ils n'entrent dans aucune statistique.
  weeklyStudyMinutesGoal: 300,
  weeklyReviewGoal: 150,
};

/**
 * Les valeurs par défaut sont fusionnées avec la ligne enregistrée : un
 * profil créé avant l'ajout d'un champ ne renvoie pas `undefined` là où le
 * reste du code attend un nombre.
 */
export async function getProfile(): Promise<Profile> {
  const stored = await db.profile.get('me');
  return stored ? { ...DEFAULT_PROFILE, ...stored } : DEFAULT_PROFILE;
}

export async function saveProfile(patch: Partial<Omit<Profile, 'id'>>): Promise<Profile> {
  const next: Profile = { ...(await getProfile()), ...patch, id: 'me' };
  await db.profile.put(next);
  return next;
}
