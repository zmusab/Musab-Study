import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/data/db';
import { DEFAULT_PROFILE } from '@/data/repositories/profile';
import type { Profile } from '@/types';

/**
 * Profil courant, en lecture réactive.
 * `useLiveQuery` réexécute la requête quand la table change : enregistrer son
 * prénom dans Paramètres met à jour l'en-tête sans rechargement.
 */
export function useProfile(): Profile {
  return useLiveQuery(
    // Même fusion que `getProfile` : un profil enregistré avant l'ajout d'un
    // champ ne doit pas renvoyer `undefined` à l'interface.
    async () => {
      const stored = await db.profile.get('me');
      return stored ? { ...DEFAULT_PROFILE, ...stored } : DEFAULT_PROFILE;
    },
    [],
    DEFAULT_PROFILE,
  );
}
