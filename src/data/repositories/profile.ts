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
};

export async function getProfile(): Promise<Profile> {
  return (await db.profile.get('me')) ?? DEFAULT_PROFILE;
}

export async function saveProfile(patch: Partial<Omit<Profile, 'id'>>): Promise<Profile> {
  const next: Profile = { ...(await getProfile()), ...patch, id: 'me' };
  await db.profile.put(next);
  return next;
}
